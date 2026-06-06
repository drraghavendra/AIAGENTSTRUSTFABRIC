import time
import requests
import sys

BASE_URL = "http://localhost:8000"

def run_tests():
    print("==================================================")
    print("GUARDIAN RUNTIME - INTEGRATION TEST SUITE")
    print("==================================================")

    # Check backend is running
    try:
        requests.get(f"{BASE_URL}/stats")
    except requests.exceptions.ConnectionError:
        print(f"Error: Backend is not running at {BASE_URL}. Please start the FastAPI server first.")
        sys.exit(1)

    print("[OK] Backend server detected.\n")

    # --------------------------------------------------
    # TEST 1: Auto-Execute Flow (Slack Message)
    # --------------------------------------------------
    print("--- TEST 1: Auto-Execution (Slack Send Message) ---")
    payload_1 = {
        "agent_id": "test-agent",
        "task_id": "task-test-1",
        "tool_name": "slack_send_message",
        "tool_payload": {
            "channel": "#general",
            "message": "Hello from automated test!"
        }
    }
    res_1 = requests.post(f"{BASE_URL}/runtime/execute", json=payload_1).json()
    print(f"Decision: {res_1.get('decision')}")
    print(f"Confidence: {res_1.get('confidence')}%")
    print(f"Status: {res_1.get('status')}")
    print(f"Audit ID: {res_1.get('audit_id')}")
    if res_1.get("status") == "completed" and res_1.get("decision") == "execute":
        print("[OK] Test 1 Passed: Executed successfully.\n")
    else:
        print("[FAIL] Test 1 Failed.\n")

    # --------------------------------------------------
    # TEST 2: Pre-execution Missing Field (Suspends & Escalates)
    # --------------------------------------------------
    print("--- TEST 2: Missing Required Field (Suspends and Escalates) ---")
    payload_2 = {
        "agent_id": "sales-agent",
        "task_id": "task-test-2",
        "tool_name": "hubspot_create_contact",
        "tool_payload": {
            # Missing "firstname"
            "email": "test_lead@example.com"
        }
    }
    res_2 = requests.post(f"{BASE_URL}/runtime/execute", json=payload_2).json()
    print(f"Decision: {res_2.get('decision')}")
    print(f"Confidence: {res_2.get('confidence')}%")
    print(f"Status: {res_2.get('status')}")
    print(f"Approval ID: {res_2.get('approval_id')}")
    print(f"Audit ID: {res_2.get('audit_id')}")
    
    approval_id = res_2.get("approval_id")
    if res_2.get("decision") == "ask_human" and approval_id is not None:
        print("[OK] Test 2 Passed: Execution suspended and escalated.\n")
    else:
        print("[FAIL] Test 2 Failed.\n")
        return

    # --------------------------------------------------
    # TEST 3: Auth Refresher and Retry Flow (Simulate 401)
    # --------------------------------------------------
    print("--- TEST 3: Token Expiration and Recovery (Simulate 401) ---")
    payload_3 = {
        "agent_id": "sales-agent",
        "task_id": "task-test-3",
        "tool_name": "hubspot_create_contact",
        "tool_payload": {
            "email": "recovery_test@example.com",
            "firstname": "John",
            "simulate_error": "401"
        }
    }
    res_3 = requests.post(f"{BASE_URL}/runtime/execute", json=payload_3).json()
    print(f"Decision: {res_3.get('decision')}")
    print(f"Confidence: {res_3.get('confidence')}%")
    print(f"Status: {res_3.get('status')}")
    # Inspect audit trail
    audit_res_3 = requests.get(f"{BASE_URL}/audit/{res_3.get('audit_id')}").json()
    print("Audit Steps:")
    for step in audit_res_3.get("steps", []):
        print(f"  - {step.get('message')}")
        
    if res_3.get("status") == "completed":
        print("[OK] Test 3 Passed: Refreshed token, retried, and succeeded.\n")
    else:
        print("[FAIL] Test 3 Failed.\n")

    # --------------------------------------------------
    # TEST 4: Human Resolves Suspended Task (from Test 2)
    # --------------------------------------------------
    print("--- TEST 4: Human Resolves Suspend Queue (Approve with Overrides) ---")
    print(f"Resolving Approval ID: {approval_id}")
    resolve_payload = {
        "action": "approve",
        "override_payload": {
            "firstname": "Jane (Added by Operator)"
        }
    }
    res_4 = requests.post(
        f"{BASE_URL}/runtime/approvals/{approval_id}/resolve", 
        json=resolve_payload
    ).json()
    print(f"Decision: {res_4.get('decision')}")
    print(f"Status: {res_4.get('status')}")
    print(f"Result details: {res_4.get('result')}")
    
    if res_4.get("status") == "completed" and res_4.get("result", {}).get("firstname") == "Jane (Added by Operator)":
        print("[OK] Test 4 Passed: Human override merged and tool completed.\n")
    else:
        print("[FAIL] Test 4 Failed.\n")

    # --------------------------------------------------
    # TEST 5: Ambiguity Gate (Low Confidence -> Escalate)
    # --------------------------------------------------
    print("--- TEST 5: Ambiguity Gate (Low Confidence -> Escalate) ---")
    payload_5 = {
        "agent_id": "test-agent",
        "task_id": "task-test-5",
        "tool_name": "slack_send_message",
        "tool_payload": {
            "channel": "#general",
            "message": "TODO: test some placeholder asdf details"
        }
    }
    res_5 = requests.post(f"{BASE_URL}/runtime/execute", json=payload_5).json()
    print(f"Decision: {res_5.get('decision')}")
    print(f"Confidence: {res_5.get('confidence')}%")
    print(f"Status: {res_5.get('status')}")
    print(f"Approval ID: {res_5.get('approval_id')}")
    if res_5.get("decision") == "ask_human" and res_5.get("status") == "pending_approval":
        print("[OK] Test 5 Passed: Ambiguity caused escalation as expected.\n")
        # Reject this one to clean up
        requests.post(
            f"{BASE_URL}/runtime/approvals/{res_5.get('approval_id')}/resolve",
            json={"action": "reject"}
        )
    else:
        print("[FAIL] Test 5 Failed.\n")

    # --------------------------------------------------
    # PRINT SUMMARY STATS
    # --------------------------------------------------
    print("--- SYSTEM STATUS SUMMARY ---")
    stats = requests.get(f"{BASE_URL}/stats").json()
    print(f"Total Intercepted Executions: {stats.get('total_executions')}")
    print(f"Success Rate: {stats.get('success_rate')}%")
    print(f"Escalation Rate: {stats.get('escalation_rate')}%")
    print(f"Active Agents: {stats.get('active_agents')}")
    print(f"Total Failure Count: {stats.get('total_failures')}")
    print(f"Pending Approvals: {stats.get('total_pending_approvals')}")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
