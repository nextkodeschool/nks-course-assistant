"""Measure the score gap between on-topic and off-topic questions.

Run it after indexing a new corpus to find where RELEVANCE_THRESHOLD in
app/chat/orchestrator.py should sit. From the repository root:

    docker compose cp scripts/calibrate-threshold.py api:/app/calibrate.py
    docker compose exec api python /app/calibrate.py

Edit the ON and OFF lists to match your own course. The point is the gap
between the lowest on-topic score and the highest off-topic one: put the
threshold inside it, and if there is no gap, raise the threshold rather
than lower it.
"""
import asyncio, os
os.environ["DATABASE_URL"] = "postgresql+asyncpg://nks:nks@postgres:5432/nks"
os.environ["SESSION_SECRET"] = "a" * 64
os.environ["KB_MODE"] = "local"
os.environ["EMBEDDING_BASE_URL"] = "http://host.docker.internal:11434/v1"
os.environ["EMBEDDING_MODEL"] = "nomic-embed-text"
os.environ["LLM_BASE_URL"] = "http://host.docker.internal:11434/v1"
os.environ["LLM_MODEL"] = "qwen2.5-coder:3b"

from app.db.session import SessionLocal
from app.retrieval.local import LocalRetriever

ON = [
    "Why does my container ignore SIGTERM?",
    "What is the difference between liveness and readiness probes?",
    "How do I make my Docker build cache better?",
    "What does exit code 137 mean?",
    "Why is my image so large?",
    "What does PID 1 do?",
    "Should readiness check the database?",
    "What is a multi-stage build?",
    "How long is terminationGracePeriodSeconds?",
    "Why not run as root in a container?",
]
OFF = [
    "What is the best pizza topping in Rome?",
    "Who won the world cup in 1998?",
    "How do I bake sourdough bread?",
    "What is the capital of Peru?",
    "Recommend a good film for tonight",
    "How do I train for a marathon?",
    "What is the weather like tomorrow?",
    "Explain quantum entanglement to a child",
]


async def main():
    async with SessionLocal() as db:
        r = LocalRetriever(db)
        on_scores, off_scores = [], []

        print("\nON-TOPIC (should be answered)\n")
        for q in ON:
            chunks = await r.search(q)
            best = max((c.score for c in chunks), default=0.0)
            on_scores.append(best)
            print(f"  {best:.4f}  {q}")

        print("\nOFF-TOPIC (should be refused)\n")
        for q in OFF:
            chunks = await r.search(q)
            best = max((c.score for c in chunks), default=0.0)
            off_scores.append(best)
            print(f"  {best:.4f}  {q}")

        lo_on, hi_off = min(on_scores), max(off_scores)
        print(f"\n{'='*58}")
        print(f"  lowest on-topic   {lo_on:.4f}")
        print(f"  highest off-topic {hi_off:.4f}")
        print(f"  gap               {lo_on - hi_off:+.4f}")
        if lo_on > hi_off:
            print(f"  --> any threshold in ({hi_off:.4f}, {lo_on:.4f}) separates them")
            print(f"  --> midpoint = {(lo_on + hi_off) / 2:.4f}")
        else:
            print("  --> OVERLAP: no threshold separates these cleanly")
        print(f"{'='*58}\n")


asyncio.run(main())
