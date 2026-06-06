from typing import Dict, Any, List

class ToolDefinition:
    def __init__(self, name: str, description: str, required_fields: List[str], base_reliability: float):
        self.name = name
        self.description = description
        self.required_fields = required_fields
        self.base_reliability = base_reliability

# Pre-defined tools for agent execution
TOOLS_REGISTRY: Dict[str, ToolDefinition] = {
    "hubspot_create_contact": ToolDefinition(
        name="hubspot_create_contact",
        description="Creates a contact in HubSpot CRM.",
        required_fields=["email", "firstname"],
        base_reliability=0.92
    ),
    "slack_send_message": ToolDefinition(
        name="slack_send_message",
        description="Sends a text message to a specific Slack channel.",
        required_fields=["channel", "message"],
        base_reliability=0.96
    ),
    "database_query": ToolDefinition(
        name="database_query",
        description="Executes a SQL read query on the company analytics database.",
        required_fields=["query"],
        base_reliability=0.85
    )
}

def simulate_tool_execution(tool_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simulates tool execution and triggers errors if requested in the payload.
    """
    if tool_name not in TOOLS_REGISTRY:
        raise ValueError(f"Tool '{tool_name}' is not registered.")

    # Check for simulated error flag
    simulate_error = payload.get("simulate_error")

    if simulate_error == "401" or simulate_error == "expired_auth":
        return {
            "status_code": 401,
            "error": "Unauthorized",
            "message": "Authentication credentials expired or invalid."
        }
    elif simulate_error == "429" or simulate_error == "rate_limit":
        return {
            "status_code": 429,
            "error": "Too Many Requests",
            "message": "Rate limit exceeded. Please try again later."
        }
    elif simulate_error == "timeout":
        return {
            "status_code": 504,
            "error": "Gateway Timeout",
            "message": "The server did not respond in time."
        }
    elif simulate_error == "empty_response":
        # Returns an empty dict to simulate empty responses
        return {}
    elif simulate_error == "invalid_json":
        # Returns a dict that simulates invalid/broken format
        return {
            "raw_text": "{invalid_json_state_broken_output"
        }
    elif simulate_error == "500" or simulate_error == "server_error":
        return {
            "status_code": 500,
            "error": "Internal Server Error",
            "message": "An unexpected error occurred."
        }

    # Successful simulations
    if tool_name == "hubspot_create_contact":
        return {
            "status_code": 201,
            "contact_id": "892019",
            "email": payload.get("email"),
            "firstname": payload.get("firstname"),
            "lastname": payload.get("lastname", ""),
            "status": "created"
        }
    elif tool_name == "slack_send_message":
        return {
            "status_code": 200,
            "ok": True,
            "channel": payload.get("channel"),
            "ts": "1717670400.001200",
            "message": "Message posted successfully"
        }
    elif tool_name == "database_query":
        return {
            "status_code": 200,
            "rows_returned": 3,
            "columns": ["id", "name", "revenue"],
            "data": [
                [1, "Acme Corp", 50000],
                [2, "Stark Industries", 120000],
                [3, "Wayne Enterprises", 95000]
            ]
        }

    return {
        "status_code": 200,
        "message": "Execution successful"
    }
