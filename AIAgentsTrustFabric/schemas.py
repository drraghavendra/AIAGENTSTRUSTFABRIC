from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime

class RuntimeExecuteInput(BaseModel):
    agent_id: str
    task_id: str
    tool_name: str
    tool_payload: Dict[str, Any]

class RuntimeExecuteResponse(BaseModel):
    decision: str
    confidence: int
    result: Optional[Any] = None
    audit_id: str
    approval_id: Optional[str] = None
    status: str  # e.g., "completed", "pending_approval", "aborted"

class AuditLogResponse(BaseModel):
    id: str
    agent_id: str
    task_id: str
    tool_name: str
    tool_payload: Dict[str, Any]
    steps: List[Dict[str, Any]]
    decision: str
    confidence: int
    success: bool
    result: Optional[Any] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class HumanApprovalResponse(BaseModel):
    id: str
    audit_id: str
    agent_id: str
    task_id: str
    tool_name: str
    tool_payload: Dict[str, Any]
    reason: str
    confidence_score: int
    status: str
    created_at: datetime
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ApprovalResolveInput(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    override_payload: Optional[Dict[str, Any]] = None

class DashboardStats(BaseModel):
    total_executions: int
    success_rate: float
    escalation_rate: float
    active_agents: int
    total_failures: int
    total_pending_approvals: int

class WorkflowCreate(BaseModel):
    name: str

class WorkflowResponse(BaseModel):
    id: str
    name: str
    key: str
    created_at: datetime

    class Config:
        from_attributes = True

class WorkflowStats(BaseModel):
    id: str
    name: str
    key: str
    created_at: datetime
    success_rate: float
    failure_rate: float
    recovery_rate: float
    health_score: float
    total_runs: int
    last_active: Optional[datetime] = None

    class Config:
        from_attributes = True

class WorkflowDetailResponse(BaseModel):
    workflow: WorkflowResponse
    stats: WorkflowStats
    recent_audits: List[AuditLogResponse]
    pending_approvals: List[HumanApprovalResponse]
    learnings: List[str]

