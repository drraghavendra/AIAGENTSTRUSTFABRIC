import time
import datetime
import secrets
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Any, Optional, cast

from .database import get_db, Base, engine
from .models import OperationalMemory, AuditLog, HumanApproval, Workflow
from .schemas import (
    RuntimeExecuteInput,
    RuntimeExecuteResponse,
    AuditLogResponse,
    HumanApprovalResponse,
    ApprovalResolveInput,
    DashboardStats,
    WorkflowCreate,
    WorkflowResponse,
    WorkflowStats,
    WorkflowDetailResponse
)
from .failure_detection import check_pre_execution_failures, check_post_execution_failures
from .confidence_engine import calculate_confidence
from .recovery_engine import determine_recovery_action
from .tools_registry import simulate_tool_execution, TOOLS_REGISTRY

# Create database tables
Base.metadata.create_all(bind=engine)

# Programmatic SQLite migrations to add workflow_id to existing tables safely
with engine.connect() as conn:
    for table in ["audit_logs", "human_approvals", "operational_memory"]:
        try:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN workflow_id VARCHAR;"))
            conn.commit()
        except Exception:
            pass

app = FastAPI(title="Guardian Runtime API")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def add_audit_step(audit: AuditLog, message: str, db: Session):
    steps = list(cast(List[Any], audit.steps)) if audit.steps else []
    steps.append({
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "message": message
    })
    audit.steps = cast(Any, steps)
    db.add(audit)
    db.commit()
    db.refresh(audit)

def run_tool_execution_loop(
    agent_id: str,
    task_id: str,
    tool_name: str,
    tool_payload: Dict[str, Any],
    audit: AuditLog,
    db: Session,
    workflow_id: Optional[str] = None
) -> RuntimeExecuteResponse:
    max_retries = 3
    retry_count = 0
    current_payload = tool_payload.copy()
    last_response = None
    success = False
    recovery_used_names = []
    post_fail = None

    add_audit_step(audit, f"Starting execution for tool: {tool_name}", db)

    while retry_count <= max_retries:
        try:
            # Simulate/execute tool
            response = simulate_tool_execution(tool_name, current_payload)
            last_response = response

            # Run post-execution failure detection
            post_fail = check_post_execution_failures(tool_name, response)

            if post_fail:
                failure_type = post_fail["failure_type"]
                message = post_fail["message"]
                add_audit_step(audit, f"Post-execution failure detected: {failure_type} - {message}", db)

                # Consult recovery engine
                recovery = determine_recovery_action(failure_type, tool_name, response)
                recovery_used_names.append(recovery["recovery_action"])
                add_audit_step(audit, f"Applied Recovery Action: {recovery['recovery_action']}", db)

                if recovery["retry"] and retry_count < max_retries:
                    retry_count += 1
                    # If rate limit, delay retry
                    if failure_type == "rate_limit":
                        add_audit_step(audit, "Rate limit recovery: sleeping for 2 seconds before retry...", db)
                        time.sleep(2)
                    elif failure_type == "expired_auth":
                        # Clear simulated error to represent token refresh success
                        if "simulate_error" in current_payload:
                            current_payload.pop("simulate_error")
                    add_audit_step(audit, f"Retrying tool execution (Attempt {retry_count}/{max_retries})...", db)
                    continue
                else:
                    success = False
                    break
            else:
                success = True
                break
        except Exception as e:
            success = False
            add_audit_step(audit, f"System exception encountered during tool run: {str(e)}", db)
            recovery = determine_recovery_action("server_error", tool_name, {"error": str(e)})
            recovery_used_names.append(recovery["recovery_action"])
            add_audit_step(audit, f"Applied Recovery Action: {recovery['recovery_action']}", db)
            
            if recovery["retry"] and retry_count < max_retries:
                retry_count += 1
                add_audit_step(audit, f"Retrying tool execution (Attempt {retry_count}/{max_retries})...", db)
                continue
            else:
                break

    # Save Outcome in Memory
    mem = OperationalMemory(
        workflow_id=workflow_id,
        agent_id=agent_id,
        task_id=task_id,
        tool_name=tool_name,
        tool_payload=tool_payload,
        failure_type=post_fail["failure_type"] if (not success and post_fail) else None,
        recovery_used=", ".join(recovery_used_names) if recovery_used_names else None,
        success=success,
        result=last_response
    )
    db.add(mem)

    # Complete Audit Record
    audit.success = success
    audit.result = last_response
    db.add(audit)
    db.commit()

    if success:
        add_audit_step(audit, "Tool execution completed successfully.", db)
        return RuntimeExecuteResponse(
            decision=audit.decision,
            confidence=audit.confidence,
            result=last_response,
            audit_id=audit.id,
            status="completed"
        )
    else:
        add_audit_step(audit, "Tool execution failed and recovery path exhausted.", db)
        return RuntimeExecuteResponse(
            decision=audit.decision,
            confidence=audit.confidence,
            result=last_response,
            audit_id=audit.id,
            status="aborted"
        )

@app.post("/runtime/execute", response_model=RuntimeExecuteResponse)
def execute_runtime(
    payload: RuntimeExecuteInput, 
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(None),
    api_key: Optional[str] = None
):
    # Resolve workflow via header, query string or payload
    key = x_api_key or api_key
    if not key and payload.tool_payload:
        key = payload.tool_payload.get("workflow_key") or payload.tool_payload.get("api_key")
    
    workflow = None
    if key:
        workflow = db.query(Workflow).filter_by(key=key).first()
    workflow_id = workflow.id if workflow else None

    # 1. Create Audit Log
    audit = AuditLog(
        workflow_id=workflow_id,
        agent_id=payload.agent_id,
        task_id=payload.task_id,
        tool_name=payload.tool_name,
        tool_payload=payload.tool_payload,
        decision="pending",
        confidence=100,
        success=False,
        steps=[]
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)

    add_audit_step(audit, "Guardian intercepted tool invocation request.", db)

    # 2. Run Pre-execution Failure Detection
    pre_fail = check_pre_execution_failures(
        agent_id=payload.agent_id,
        task_id=payload.task_id,
        tool_name=payload.tool_name,
        tool_payload=payload.tool_payload,
        db=db,
        workflow_id=workflow_id
    )

    if pre_fail:
        failure_type = pre_fail["failure_type"]
        message = pre_fail["message"]
        add_audit_step(audit, f"Pre-execution failure detected: {failure_type} - {message}", db)

        # Consult Recovery Engine
        recovery = determine_recovery_action(failure_type, payload.tool_name, pre_fail)
        add_audit_step(audit, f"Applied Recovery Action: {recovery['recovery_action']}", db)

        if failure_type == "missing_required_fields":
            # Escalate to human to request field inputs
            approval = HumanApproval(
                workflow_id=workflow_id,
                audit_id=audit.id,
                agent_id=payload.agent_id,
                task_id=payload.task_id,
                tool_name=payload.tool_name,
                tool_payload=payload.tool_payload,
                reason=f"Missing required fields: {message}",
                confidence_score=45,
                status="pending"
            )
            db.add(approval)
            db.commit()
            db.refresh(approval)

            audit.decision = cast(Any, "ask_human")
            audit.confidence = 45
            db.add(audit)
            db.commit()

            add_audit_step(audit, f"Action suspended. Escalating to human operator queue (Approval ID: {approval.id}).", db)
            return RuntimeExecuteResponse(
                decision="ask_human",
                confidence=45,
                result=None,
                audit_id=audit.id,
                approval_id=approval.id,
                status="pending_approval"
            )
        else:
            # Duplicate execution or Infinite loops -> Abort immediately
            audit.decision = cast(Any, "abort")
            audit.confidence = 20
            db.add(audit)

            mem = OperationalMemory(
                workflow_id=workflow_id,
                agent_id=payload.agent_id,
                task_id=payload.task_id,
                tool_name=payload.tool_name,
                tool_payload=payload.tool_payload,
                failure_type=failure_type,
                recovery_used=recovery["recovery_action"],
                success=False,
                result=None
            )
            db.add(mem)
            db.commit()

            add_audit_step(audit, f"Execution aborted: Safety gate triggered (reason: {failure_type}).", db)
            return RuntimeExecuteResponse(
                decision="abort",
                confidence=20,
                result=None,
                audit_id=audit.id,
                status="aborted"
            )

    # 3. Run Confidence Engine
    confidence, risk, decision, reason = calculate_confidence(
        agent_id=payload.agent_id,
        task_id=payload.task_id,
        tool_name=payload.tool_name,
        tool_payload=payload.tool_payload,
        db=db,
        workflow_id=workflow_id
    )

    add_audit_step(audit, f"Confidence Engine assessment completed: Score {confidence}% ({risk} risk). Reason: {reason}", db)
    audit.confidence = confidence

    if decision == "abort":
        audit.decision = cast(Any, "abort")
        db.add(audit)
        
        mem = OperationalMemory(
            workflow_id=workflow_id,
            agent_id=payload.agent_id,
            task_id=payload.task_id,
            tool_name=payload.tool_name,
            tool_payload=payload.tool_payload,
            failure_type="aborted_by_confidence_gate",
            success=False
        )
        db.add(mem)
        db.commit()
        
        add_audit_step(audit, "Execution aborted by confidence gate safety rules.", db)
        return RuntimeExecuteResponse(
            decision="abort",
            confidence=confidence,
            audit_id=audit.id,
            status="aborted"
        )

    elif decision == "ask_human":
        # Suspend execution, store pending approval
        approval = HumanApproval(
            workflow_id=workflow_id,
            audit_id=audit.id,
            agent_id=payload.agent_id,
            task_id=payload.task_id,
            tool_name=payload.tool_name,
            tool_payload=payload.tool_payload,
            reason=reason,
            confidence_score=confidence,
            status="pending"
        )
        db.add(approval)
        db.commit()
        db.refresh(approval)

        audit.decision = cast(Any, "ask_human")
        db.add(audit)
        db.commit()

        add_audit_step(audit, f"Action suspended. Escalating to human operator queue (Approval ID: {approval.id}).", db)
        return RuntimeExecuteResponse(
            decision="ask_human",
            confidence=confidence,
            result=None,
            audit_id=audit.id,
            approval_id=approval.id,
            status="pending_approval"
        )

    # decision is "execute"
    audit.decision = cast(Any, "execute")
    db.add(audit)
    db.commit()

    return run_tool_execution_loop(payload.agent_id, payload.task_id, payload.tool_name, payload.tool_payload, audit, db, workflow_id=workflow_id)

@app.post("/runtime/approvals/{approval_id}/resolve")
def resolve_approval(approval_id: str, input_data: ApprovalResolveInput, db: Session = Depends(get_db)):
    approval = db.query(HumanApproval).filter_by(id=approval_id, status="pending").first()
    if not approval:
        raise HTTPException(status_code=404, detail="Pending human approval not found.")

    audit = db.query(AuditLog).filter_by(id=approval.audit_id).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit log not found.")

    approval.status = input_data.action + "ed"  # approved / rejected
    approval.resolved_at = datetime.datetime.utcnow()
    db.add(approval)
    db.commit()

    if input_data.action == "reject":
        add_audit_step(audit, "Human operator REJECTED the tool execution.", db)
        
        mem = OperationalMemory(
            workflow_id=approval.workflow_id,
            agent_id=approval.agent_id,
            task_id=approval.task_id,
            tool_name=approval.tool_name,
            tool_payload=approval.tool_payload,
            failure_type="human_rejected",
            success=False
        )
        db.add(mem)

        audit.decision = cast(Any, "abort")
        audit.success = cast(Any, False)
        db.add(audit)
        db.commit()

        return {"status": "resolved", "action": "rejected", "audit_id": audit.id}

    # If approved
    add_audit_step(audit, "Human operator APPROVED the tool execution.", db)

    # Merge override payload if provided
    final_payload = cast(Dict[str, Any], approval.tool_payload).copy()
    if input_data.override_payload:
        final_payload.update(input_data.override_payload)
        add_audit_step(audit, f"Merged operator payload override values: {input_data.override_payload}", db)
        audit.tool_payload = cast(Any, final_payload)
        db.add(audit)
        db.commit()

    # Resume the execution loop
    response = run_tool_execution_loop(
        approval.agent_id, 
        approval.task_id, 
        approval.tool_name, 
        final_payload, 
        audit, 
        db, 
        workflow_id=approval.workflow_id
    )
    return response

@app.get("/runtime/status/{audit_id}", response_model=RuntimeExecuteResponse)
def get_runtime_status(audit_id: str, db: Session = Depends(get_db)):
    audit = db.query(AuditLog).filter_by(id=audit_id).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit log not found.")

    approval = db.query(HumanApproval).filter_by(audit_id=audit_id).first()
    approval_id = approval.id if approval else None

    status = "completed" if audit.success else "aborted"
    if audit.decision == "ask_human" and approval and approval.status == "pending":
        status = "pending_approval"

    return RuntimeExecuteResponse(
        decision=audit.decision,
        confidence=audit.confidence,
        result=audit.result,
        audit_id=audit.id,
        approval_id=approval_id,
        status=status
    )

@app.get("/runtime/approvals", response_model=List[HumanApprovalResponse])
def list_pending_approvals(db: Session = Depends(get_db)):
    return db.query(HumanApproval).filter_by(status="pending").order_by(cast(Any, HumanApproval.created_at).desc()).all()

@app.get("/audit/{audit_id}", response_model=AuditLogResponse)
def get_audit_trail(audit_id: str, db: Session = Depends(get_db)):
    audit = db.query(AuditLog).filter_by(id=audit_id).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit log not found.")
    return audit

@app.get("/audit", response_model=List[AuditLogResponse])
def list_audit_logs(db: Session = Depends(get_db)):
    return db.query(AuditLog).order_by(cast(Any, AuditLog.created_at).desc()).limit(100).all()

@app.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_executions = db.query(AuditLog).count()
    
    # Success rate
    completed_runs = db.query(OperationalMemory).count()
    successful_runs = db.query(OperationalMemory).filter_by(success=True).count()
    success_rate = (successful_runs / completed_runs * 100.0) if completed_runs > 0 else 100.0

    # Escalation rate
    total_approvals = db.query(HumanApproval).count()
    escalation_rate = (total_approvals / total_executions * 100.0) if total_executions > 0 else 0.0

    active_agents = db.query(cast(Any, OperationalMemory.agent_id)).distinct().count()
    if active_agents == 0:
        active_agents = db.query(cast(Any, AuditLog.agent_id)).distinct().count()

    total_failures = db.query(OperationalMemory).filter_by(success=False).count()
    total_pending_approvals = db.query(HumanApproval).filter_by(status="pending").count()

    return DashboardStats(
        total_executions=total_executions,
        success_rate=round(success_rate, 2),
        escalation_rate=round(escalation_rate, 2),
        active_agents=active_agents,
        total_failures=total_failures,
        total_pending_approvals=total_pending_approvals
    )

@app.post("/workflows", response_model=WorkflowResponse)
def create_workflow(payload: WorkflowCreate, db: Session = Depends(get_db)):
    # Generate runtime key: gdn_local_xxxxx (using secrets.token_hex(16))
    key = f"gdn_local_{secrets.token_hex(16)}"
    workflow = Workflow(name=payload.name, key=key)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return workflow

@app.get("/workflows", response_model=List[WorkflowStats])
def list_workflows(db: Session = Depends(get_db)):
    workflows = db.query(Workflow).all()
    response = []
    for w in workflows:
        # Get stats for this workflow
        total_runs = db.query(AuditLog).filter_by(workflow_id=w.id).count()
        completed_runs = db.query(OperationalMemory).filter_by(workflow_id=w.id).count()
        successful_runs = db.query(OperationalMemory).filter_by(workflow_id=w.id, success=True).count()
        total_failures = db.query(OperationalMemory).filter_by(workflow_id=w.id, success=False).count()
        
        success_rate = (successful_runs / completed_runs * 100.0) if completed_runs > 0 else 100.0
        failure_rate = (total_failures / completed_runs * 100.0) if completed_runs > 0 else 0.0
        
        recovered_runs = db.query(OperationalMemory).filter_by(
            workflow_id=w.id,
            success=True
        ).filter(cast(Any, OperationalMemory.recovery_used != None)).count()
        
        all_failures = db.query(OperationalMemory).filter_by(workflow_id=w.id, success=False).count() + recovered_runs
        recovery_rate = (recovered_runs / all_failures * 100.0) if all_failures > 0 else 100.0
        
        # Health score: 100 - failure_rate (or weighted by success rate)
        health_score = max(0.0, min(100.0, success_rate))
        
        last_audit = db.query(AuditLog).filter_by(workflow_id=w.id).order_by(cast(Any, AuditLog.created_at).desc()).first()
        last_active = last_audit.created_at if last_audit else None
        
        response.append(WorkflowStats(
            id=w.id,
            name=w.name,
            key=w.key,
            created_at=w.created_at,
            success_rate=round(success_rate, 2),
            failure_rate=round(failure_rate, 2),
            recovery_rate=round(recovery_rate, 2),
            health_score=round(health_score, 2),
            total_runs=total_runs,
            last_active=last_active
        ))
    return response

@app.get("/workflows/{workflow_id}", response_model=WorkflowDetailResponse)
def get_workflow_details(workflow_id: str, db: Session = Depends(get_db)):
    w = db.query(Workflow).filter_by(id=workflow_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Workflow not found.")
        
    # Calculate stats
    total_runs = db.query(AuditLog).filter_by(workflow_id=w.id).count()
    completed_runs = db.query(OperationalMemory).filter_by(workflow_id=w.id).count()
    successful_runs = db.query(OperationalMemory).filter_by(workflow_id=w.id, success=True).count()
    total_failures = db.query(OperationalMemory).filter_by(workflow_id=w.id, success=False).count()
    
    success_rate = (successful_runs / completed_runs * 100.0) if completed_runs > 0 else 100.0
    failure_rate = (total_failures / completed_runs * 100.0) if completed_runs > 0 else 0.0
    
    recovered_runs = db.query(OperationalMemory).filter_by(
        workflow_id=w.id,
        success=True
    ).filter(cast(Any, OperationalMemory.recovery_used != None)).count()
    
    all_failures = db.query(OperationalMemory).filter_by(workflow_id=w.id, success=False).count() + recovered_runs
    recovery_rate = (recovered_runs / all_failures * 100.0) if all_failures > 0 else 100.0
    health_score = max(0.0, min(100.0, success_rate))
    
    last_audit = db.query(AuditLog).filter_by(workflow_id=w.id).order_by(cast(Any, AuditLog.created_at).desc()).first()
    last_active = last_audit.created_at if last_audit else None
    
    stats = WorkflowStats(
        id=w.id,
        name=w.name,
        key=w.key,
        created_at=w.created_at,
        success_rate=round(success_rate, 2),
        failure_rate=round(failure_rate, 2),
        recovery_rate=round(recovery_rate, 2),
        health_score=round(health_score, 2),
        total_runs=total_runs,
        last_active=last_active
    )
    
    # Recent audits
    recent_audits = db.query(AuditLog).filter_by(workflow_id=w.id).order_by(cast(Any, AuditLog.created_at).desc()).limit(20).all()
    
    # Pending approvals
    pending_approvals = db.query(HumanApproval).filter_by(workflow_id=w.id, status="pending").order_by(cast(Any, HumanApproval.created_at).desc()).all()
    
    # Learnings / insights
    # We'll fetch them from OperationalMemory records where recovery_used was successful
    memories = db.query(OperationalMemory).filter_by(
        workflow_id=w.id
    ).filter(cast(Any, OperationalMemory.recovery_used != None)).order_by(
        cast(Any, OperationalMemory.timestamp).desc()
    ).limit(10).all()
    
    learnings = []
    seen_learnings = set()
    for m in memories:
        learning_text = f"Tool '{m.tool_name}' failure: recovered with strategy '{m.recovery_used}'."
        if m.success and m.recovery_used:
            if m.failure_type == "expired_auth" or "401" in str(m.result):
                learning_text = f"Authentication failures on '{m.tool_name}' are automatically resolved with token refresh."
            elif m.failure_type == "rate_limit" or "429" in str(m.result):
                learning_text = f"Rate limits on '{m.tool_name}' are managed via automatic exponential backoff."
            elif m.failure_type == "timeout" or "504" in str(m.result):
                learning_text = f"Timeouts on '{m.tool_name}' are automatically recovered with increased request timeout limit."
        if learning_text not in seen_learnings:
            learnings.append(learning_text)
            seen_learnings.add(learning_text)
            
    # Fallback learnings if empty
    if not learnings:
        learnings = ["No recovery events logged yet. Insights will appear once failure recovery is triggered."]
        
    return WorkflowDetailResponse(
        workflow=w,
        stats=stats,
        recent_audits=recent_audits,
        pending_approvals=pending_approvals,
        learnings=learnings
    )

@app.get("/workflows/{workflow_id}/insights", response_model=List[str])
def get_workflow_insights(workflow_id: str, db: Session = Depends(get_db)):
    details = get_workflow_details(workflow_id, db)
    return details.learnings

