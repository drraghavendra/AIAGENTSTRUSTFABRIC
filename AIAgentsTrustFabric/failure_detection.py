import datetime
from typing import Dict, Any, Optional, cast
from sqlalchemy.orm import Session
from .models import OperationalMemory
from .tools_registry import TOOLS_REGISTRY

def check_pre_execution_failures(
    agent_id: str,
    task_id: str,
    tool_name: str,
    tool_payload: Dict[str, Any],
    db: Session,
    workflow_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Checks for failures BEFORE the tool executes.
    Detects:
    - missing_required_fields
    - duplicate_execution
    - infinite_loop
    """
    # 1. Check if tool is registered
    tool_def = TOOLS_REGISTRY.get(tool_name)
    if not tool_def:
        return {
            "failure_detected": True,
            "failure_type": "unregistered_tool",
            "message": f"Tool '{tool_name}' is not registered in Guardian."
        }

    # 2. Missing Required Fields
    missing_fields = [field for field in tool_def.required_fields if field not in tool_payload]
    if missing_fields:
        return {
            "failure_detected": True,
            "failure_type": "missing_required_fields",
            "message": f"Missing required fields: {', '.join(missing_fields)}"
        }

    # 3. Duplicate Execution Attempts
    # Check if the exact same tool + payload has been successfully run for this task/agent in the last 15 seconds
    fifteen_seconds_ago = datetime.datetime.utcnow() - datetime.timedelta(seconds=15)
    recent_runs = db.query(OperationalMemory).filter_by(
        workflow_id=workflow_id,
        agent_id=agent_id,
        task_id=task_id,
        tool_name=tool_name
    ).filter(
        cast(Any, OperationalMemory.timestamp >= fifteen_seconds_ago)
    ).all()

    for run in recent_runs:
        if run.tool_payload == tool_payload and run.success:
            return {
                "failure_detected": True,
                "failure_type": "duplicate_execution",
                "message": f"Duplicate tool execution detected within 15 seconds for payload."
            }

    # 4. Infinite Loop Patterns
    # If the same tool has been run more than 3 times in the last 60 seconds with consecutive failures, flag infinite loop
    one_minute_ago = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    recent_failures = db.query(OperationalMemory).filter_by(
        workflow_id=workflow_id,
        agent_id=agent_id,
        task_id=task_id
    ).filter(
        cast(Any, OperationalMemory.timestamp >= one_minute_ago)
    ).order_by(cast(Any, OperationalMemory.timestamp).desc()).all()


    if len(recent_failures) >= 3:
        consecutive_tool_failures = 0
        for run in recent_failures:
            if run.tool_name == tool_name and not run.success:
                consecutive_tool_failures += 1
            else:
                break
        
        if consecutive_tool_failures >= 3:
            return {
                "failure_detected": True,
                "failure_type": "infinite_loop",
                "message": f"Infinite loop detected: tool '{tool_name}' failed {consecutive_tool_failures} times consecutively in the last minute."
            }

    return None

def check_post_execution_failures(
    tool_name: str,
    response: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Checks for failures AFTER the tool executes.
    Detects:
    - expired_auth
    - rate_limit
    - timeout
    - empty_response
    - invalid_response
    """
    # 1. Empty Response
    if not response or (isinstance(response, dict) and len(response) == 0):
        return {
            "failure_detected": True,
            "failure_type": "empty_response",
            "message": "Tool execution returned an empty response."
        }

    # Response is not a dict
    if not isinstance(response, dict):
        return {
            "failure_detected": True,
            "failure_type": "invalid_response",
            "message": f"Tool response is not a valid JSON dictionary: {response}"
        }

    # Check for invalid JSON structure (e.g. simulated raw text error)
    if "raw_text" in response and "invalid" in response.get("raw_text", ""):
        return {
            "failure_detected": True,
            "failure_type": "invalid_response",
            "message": f"Tool response returned invalid formatting: {response.get('raw_text')}"
        }

    status_code = response.get("status_code")
    error = response.get("error", "")
    message = response.get("message", "")

    # 2. Authentication Failures
    if status_code == 401 or "unauthorized" in str(error).lower() or "auth" in str(message).lower() or "expired_auth" in str(error).lower():
        return {
            "failure_detected": True,
            "failure_type": "expired_auth",
            "message": "Authentication token expired or invalid."
        }

    # 3. Rate Limits
    if status_code == 429 or "rate limit" in str(message).lower() or "too many requests" in str(error).lower() or "rate_limit" in str(error).lower():
        return {
            "failure_detected": True,
            "failure_type": "rate_limit",
            "message": "Rate limit hit (HTTP 429)."
        }

    # 4. Timeout
    if status_code == 504 or "timeout" in str(error).lower() or "timeout" in str(message).lower():
        return {
            "failure_detected": True,
            "failure_type": "timeout",
            "message": "Tool execution timed out."
        }

    # 5. Generic server error
    if status_code and isinstance(status_code, int) and status_code >= 500:
        return {
            "failure_detected": True,
            "failure_type": "server_error",
            "message": f"Server returned error code {status_code}."
        }

    return None
