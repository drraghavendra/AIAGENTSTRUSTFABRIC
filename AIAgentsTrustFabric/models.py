import uuid
import datetime
from typing import Any, Optional
from sqlalchemy import Column, String, Integer, Boolean, DateTime, JSON
from .database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Workflow(Base):
    __tablename__ = "workflows"

    id: str = Column(String, primary_key=True, default=generate_uuid)  # type: ignore
    name: str = Column(String, nullable=False)  # type: ignore
    key: str = Column(String, unique=True, index=True, nullable=False)  # type: ignore
    created_at: datetime.datetime = Column(DateTime, default=datetime.datetime.utcnow)  # type: ignore

class OperationalMemory(Base):
    __tablename__ = "operational_memory"

    id: str = Column(String, primary_key=True, default=generate_uuid)  # type: ignore
    workflow_id: Optional[str] = Column(String, index=True, nullable=True)  # type: ignore
    agent_id: str = Column(String, index=True, nullable=False)  # type: ignore
    task_id: str = Column(String, index=True, nullable=False)  # type: ignore
    tool_name: str = Column(String, index=True, nullable=False)  # type: ignore
    tool_payload: Any = Column(JSON, nullable=False)  # type: ignore
    failure_type: Optional[str] = Column(String, nullable=True)  # type: ignore
    recovery_used: Optional[str] = Column(String, nullable=True)  # type: ignore
    success: bool = Column(Boolean, default=True)  # type: ignore
    result: Optional[Any] = Column(JSON, nullable=True)  # type: ignore
    timestamp: datetime.datetime = Column(DateTime, default=datetime.datetime.utcnow)  # type: ignore

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: str = Column(String, primary_key=True, default=generate_uuid)  # type: ignore
    workflow_id: Optional[str] = Column(String, index=True, nullable=True)  # type: ignore
    agent_id: str = Column(String, index=True, nullable=False)  # type: ignore
    task_id: str = Column(String, index=True, nullable=False)  # type: ignore
    tool_name: str = Column(String, index=True, nullable=False)  # type: ignore
    tool_payload: Any = Column(JSON, nullable=False)  # type: ignore
    steps: list = Column(JSON, default=list)  # type: ignore
    decision: str = Column(String, nullable=False)  # type: ignore
    confidence: int = Column(Integer, nullable=False)  # type: ignore
    success: bool = Column(Boolean, default=False)  # type: ignore
    result: Optional[Any] = Column(JSON, nullable=True)  # type: ignore
    created_at: datetime.datetime = Column(DateTime, default=datetime.datetime.utcnow)  # type: ignore
    updated_at: datetime.datetime = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)  # type: ignore

class HumanApproval(Base):
    __tablename__ = "human_approvals"

    id: str = Column(String, primary_key=True, default=generate_uuid)  # type: ignore
    workflow_id: Optional[str] = Column(String, index=True, nullable=True)  # type: ignore
    audit_id: str = Column(String, index=True, nullable=False)  # type: ignore
    agent_id: str = Column(String, index=True, nullable=False)  # type: ignore
    task_id: str = Column(String, index=True, nullable=False)  # type: ignore
    tool_name: str = Column(String, nullable=False)  # type: ignore
    tool_payload: Any = Column(JSON, nullable=False)  # type: ignore
    reason: str = Column(String, nullable=False)  # type: ignore
    confidence_score: int = Column(Integer, nullable=False)  # type: ignore
    status: str = Column(String, default="pending", index=True)  # type: ignore
    created_at: datetime.datetime = Column(DateTime, default=datetime.datetime.utcnow)  # type: ignore
    resolved_at: Optional[datetime.datetime] = Column(DateTime, nullable=True)  # type: ignore




