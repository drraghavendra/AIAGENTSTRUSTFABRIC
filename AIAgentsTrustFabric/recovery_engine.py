import time
import json
import logging
from typing import Dict, Any, Optional
import google.generativeai as genai
from .config import settings

logger = logging.getLogger(__name__)

# Configure Gemini if key is present
if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)

def call_gemini_recovery(tool_name: str, response_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calls Gemini API to determine dynamic recovery action for unknown failures.
    """
    if not settings.gemini_api_key:
        return {
            "recovery_action": "Unable to determine dynamic recovery (Gemini API key missing). Aborting.",
            "retry": False
        }

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = f"""
        You are the Recovery Engine of Guardian Runtime, an intelligent middleware infrastructure for AI Agents.
        A tool call has failed with an unknown error. Analyze the tool name and error response to determine if we should retry, and what recovery action to take.
        
        Tool Name: {tool_name}
        Error Response: {json.dumps(response_data, indent=2)}
        
        Provide your decision in JSON format. Do not write any other text.
        JSON Schema:
        {{
            "recovery_action": "Detailed string explaining the proposed recovery strategy (e.g., 'JSON payload parsing failed, retry after sanitizing special characters')",
            "retry": true or false
        }}
        """
        
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        
        result = json.loads(response.text.strip())
        return {
            "recovery_action": result.get("recovery_action", "Unknown dynamic recovery plan formulated by Gemini."),
            "retry": bool(result.get("retry", False))
        }
    except Exception as e:
        logger.error(f"Error calling Gemini for recovery: {e}")
        return {
            "recovery_action": f"Dynamic recovery calculation failed due to exception: {str(e)}",
            "retry": False
        }

def determine_recovery_action(
    failure_type: str,
    tool_name: str,
    response_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Maps failures to recovery actions.
    """
    if failure_type == "expired_auth":
        return {
            "recovery_action": "Automatically refreshed access token using refresh credentials and retried tool invocation.",
            "retry": True
        }
    elif failure_type == "rate_limit":
        return {
            "recovery_action": "Exponential backoff: waiting 2 seconds before retrying tool invocation.",
            "retry": True
        }
    elif failure_type == "timeout":
        return {
            "recovery_action": "Gateway timeout: increasing tool timeout threshold and retrying.",
            "retry": True
        }
    elif failure_type == "missing_required_fields":
        return {
            "recovery_action": "Escalated to human operator for payload clarification.",
            "retry": False
        }
    elif failure_type == "duplicate_execution":
        return {
            "recovery_action": "Aborted tool execution to prevent duplicate transactions.",
            "retry": False
        }
    elif failure_type == "infinite_loop":
        return {
            "recovery_action": "Aborted tool execution to break infinite tool-failure loop.",
            "retry": False
        }
    
    # Unknown failure type or server error -> Send to Gemini
    return call_gemini_recovery(tool_name, response_data)
