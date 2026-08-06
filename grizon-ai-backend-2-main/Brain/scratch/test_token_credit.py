import os
import sys
from unittest.mock import MagicMock
from datetime import datetime

# 1. Setup Mock Database Module before any imports to prevent database connections
from sqlalchemy.orm import declarative_base
Base = declarative_base()

class MockWallet:
    def __init__(self, id, userId, balance):
        self.id = id
        self.userId = userId
        self.balance = balance
        self.totalSpent = 0
        self.updatedAt = datetime.utcnow()

# Mock Session Setup
mock_session = MagicMock()
mock_wallet = MockWallet("test_wallet", "00000000-0000-0000-0000-000000000001", 100)

# Setup query mocks: db.query(CreditWallet).filter(...).first()
mock_query = MagicMock()
mock_query.filter.return_value.first.return_value = mock_wallet
mock_session.query.return_value = mock_query

mock_session_local = MagicMock(return_value=mock_session)

class MockDatabaseModule:
    SessionLocal = mock_session_local
    engine = MagicMock()
    Base = Base
    @staticmethod
    def get_db():
        yield mock_session

sys.modules['Brain.config.database'] = MockDatabaseModule

# Setup path so we can import 'Brain'
current_dir = os.path.dirname(os.path.abspath(__file__))
brain_dir = os.path.dirname(current_dir)
parent_dir = os.path.dirname(brain_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# 2. Imports of components under test
from Brain.utils.token_counter import token_counter_context, calculate_credits, TokenCounterCallbackHandler, token_counter_var
from Brain.modules.conversations.service import conversation_service
from langchain_core.messages import AIMessage
import asyncio

class DummyLLM:
    def __init__(self, callbacks=None):
        self.callbacks = callbacks or []

    async def ainvoke(self, messages):
        # Create a mock LangChain generation response with usage metadata
        class MockGeneration:
            def __init__(self):
                # Mock message with usage_metadata
                self.message = AIMessage(
                    content="Mock response content",
                    usage_metadata={
                        "input_tokens": 1500,
                        "output_tokens": 2500,
                        "total_tokens": 4000
                    }
                )
        
        class MockResponse:
            def __init__(self):
                self.generations = [[MockGeneration()]]

        response = MockResponse()
        for cb in self.callbacks:
            if hasattr(cb, 'on_llm_end'):
                cb.on_llm_end(response)
        
        return response.generations[0][0].message

async def main():
    print("Testing token counter context...")
    
    # Test token counter context manager and callback handler
    with token_counter_context() as tokens_data:
        print(f"Initial tokens: {tokens_data}")
        
        # Instantiate dummy model with token counter callback handler
        handler = TokenCounterCallbackHandler()
        llm = DummyLLM(callbacks=[handler])
        
        # Perform mock invoke
        print("Invoking mock model...")
        response = await llm.ainvoke([])
        
        print(f"Tokens after invocation: {tokens_data}")
        assert tokens_data["total_tokens"] == 4000, "Token counting failed"
        print("SUCCESS: Token counting works perfectly!")

    # Test credit calculation logic
    credits_1 = calculate_credits(3999)
    credits_2 = calculate_credits(4000)
    credits_3 = calculate_credits(4001)
    
    print(f"3999 tokens -> {credits_1} credit(s)")
    print(f"4000 tokens -> {credits_2} credit(s)")
    print(f"4001 tokens -> {credits_3} credit(s)")
    
    assert credits_1 == 1, "Calculation failed for 3999"
    assert credits_2 == 1, "Calculation failed for 4000"
    assert credits_3 == 2, "Calculation failed for 4001"
    print("SUCCESS: Credit calculation logic works perfectly (1 credit per 4000 tokens, rounded up)!")

    # Test credit wallet deduction in database
    user_id = "00000000-0000-0000-0000-000000000001"
    initial_balance = mock_wallet.balance
    print(f"Initial wallet balance: {initial_balance} credits")
    
    # Deduct credits
    amount_to_deduct = 5
    print(f"Deducting {amount_to_deduct} credits...")
    deducted = conversation_service.deduct_credits(
        user_id=user_id,
        amount=amount_to_deduct,
        reason="Test deduction"
    )
    
    final_balance = mock_wallet.balance
    print(f"Deducted: {deducted}, Final wallet balance: {final_balance} credits")
    
    assert deducted is True, "Deduction failed"
    assert final_balance == initial_balance - amount_to_deduct, "Balance update mismatch"
    print("SUCCESS: Credit deduction database updates work perfectly!")
    
if __name__ == "__main__":
    asyncio.run(main())
