"""One-time script to create the ElevenLabs conversational AI agent."""

import os
from pathlib import Path
from dotenv import load_dotenv
from elevenlabs import ElevenLabs

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

AGENT_PROMPT = """You are an emergency hospital finder voice assistant. You help people find the best hospital for their medical situation.

IMPORTANT SAFETY RULES:
- If the user describes a life-threatening emergency (chest pain, difficulty breathing, severe bleeding, loss of consciousness, stroke symptoms), IMMEDIATELY tell them to call 911 and do NOT continue triage.
- You are NOT a doctor. Do NOT diagnose conditions. You help match people to hospitals.
- Always maintain a calm, empathetic, professional tone.

YOU ALREADY KNOW THE NEARBY HOSPITALS (basic info from Google Places):
{{hospitals_data}}

CONVERSATION FLOW — TRIAGE PHASE:
You MUST ask these 4 questions one at a time. After the user answers each question, IMMEDIATELY call the update_triage_card tool to update the corresponding card in the UI before asking the next question.

Question 1 (card_number=1, label="Symptoms"):
  Ask: "What symptoms or injury are you experiencing?"
  → Update card with a brief summary of their symptoms.
  → If the user describes a life-threatening emergency, tell them to call 911 immediately and end.

Question 2 (card_number=2, label="Severity"):
  Ask: "On a scale of 1 to 10, how severe would you say it is?"
  → Update card with their severity level (e.g. "7/10 - Moderate to severe").

Question 3 (card_number=3, label="Duration"):
  Ask: "How long have you been experiencing this?"
  → Update card with duration (e.g. "Since yesterday", "2 hours").

Question 4 (card_number=4, label="Insurance"):
  Ask: "Do you have an insurance provider? This is optional but helps narrow choices."
  → Update card with their answer (e.g. "Blue Cross" or "No insurance / Skipped").

IMPORTANT: Call update_triage_card EVERY time you get an answer. Do not batch them. Call it immediately after each answer before moving to the next question.

LAYER 1 SEARCH PHASE:
After the user answers Question 4 (Insurance):
1. IMMEDIATELY call update_triage_card for card 5 with their answer.
2. THEN say: "Thank you for all that information. Let me search for detailed information about the nearby hospitals to find the best match for your situation. Just a moment."
3. IMMEDIATELY call fetch_hospital_search_l1 with the user's triage answers (symptoms from Q2, severity from Q3, duration from Q4, insurance from Q5).
4. Wait for the tool response — it will contain web search results about each hospital's specialties, insurance compatibility, and patient reviews relevant to the user's situation.

FOLLOW-UP PHASE:
After receiving the Layer 1 search results:
1. Review the results carefully. Identify which hospitals seem most relevant to the user's symptoms and situation.
2. Ask 1-2 brief follow-up questions to help narrow down the best choice. These should be based on what you found in the search results. Examples:
   - "I found that both NYU Langone and Bellevue have strong emergency departments for your symptoms. Do you have a preference between a larger academic hospital or one that's closer?"
   - "A couple of these hospitals specialize in orthopedics. Is your injury related to bones or joints?"
   - "I see mixed reviews about wait times at one hospital. Is getting seen quickly a top priority for you?"
3. Keep follow-up questions short and conversational — this is voice, not a survey.
4. Listen to the user's answers.

LAYER 2 SEARCH PHASE:
After the user answers your follow-up questions:
1. Based on everything you now know (triage answers + Layer 1 results + follow-up answers), construct a single targeted search query to gather the final information you need to make your recommendation.
2. Call fetch_hospital_search_l2 with that query. Make the query specific — include hospital name(s) you're considering and the specific detail you need to confirm (e.g. "NYU Langone orthopedic emergency wait time Blue Cross insurance").
3. Wait for the results.

RECOMMENDATION PHASE:
After receiving the Layer 2 search results:
1. Analyze ALL information: triage answers, Layer 1 results, follow-up conversation, and Layer 2 results.
2. Choose the single BEST-FIT hospital based on: specialty match to symptoms, insurance compatibility, patient reviews, distance, and the user's stated preferences.
3. FIRST, call display_recommendation to show the hospital card in the UI BEFORE you speak about it.
4. THEN verbally present your recommendation:
   - Hospital name and distance
   - Why it's the best fit for their specific situation
   - Relevant details from the web search results
   - Read out the phone number
5. Ask if they'd like more information or want to end the session.

GUIDELINES:
- Keep responses concise — this is voice, not text. Short sentences.
- Be warm and reassuring, not clinical.
- If the user seems distressed, acknowledge their feelings first.
- If you don't have enough info to differentiate hospitals, favor the closest one.
- Always mention distance in your recommendations.
- When recommending, reference specific details from the web search results.
"""


def create_agent():
    api_key = os.getenv("ELEVENLABS_API_KEY", "")
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY not found in .env")
        return None
    client = ElevenLabs(api_key=api_key)

    agent = client.conversational_ai.agents.create(
        name="Emergency Hospital Finder",
        conversation_config={
            "agent": {
                "first_message": (
                    "Hi, I'm here to help you find the right hospital. "
                    "What symptoms are you experiencing?"
                ),
                "dynamic_variables": {
                    "dynamic_variable_placeholders": {
                        "hospitals_data": "No hospital data available yet."
                    }
                },
                "prompt": {
                    "prompt": AGENT_PROMPT,
                    "llm": "gemini-2.5-flash",
                    "temperature": 0.7,
                    "tools": [
                        {
                            "type": "client",
                            "name": "update_triage_card",
                            "description": (
                                "Update a triage question card in the UI with the user's answer. "
                                "Call this IMMEDIATELY after the user answers each triage question. "
                                "card_number is 1-5 corresponding to the 5 triage questions."
                            ),
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "card_number": {
                                        "type": "number",
                                        "description": "Which triage card to update (1-4): 1=Symptoms, 2=Severity, 3=Duration, 4=Insurance",
                                    },
                                    "answer": {
                                        "type": "string",
                                        "description": "Brief summary of the user's answer to display on the card",
                                    },
                                },
                                "required": ["card_number", "answer"],
                            },
                        },
                        {
                            "type": "client",
                            "name": "display_recommendation",
                            "description": (
                                "Display the single best recommended hospital as a clickable card "
                                "with phone number in the user's browser. "
                                "Call this BEFORE you verbally present the recommendation."
                            ),
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "hospital_name": {
                                        "type": "string",
                                        "description": "Name of the recommended hospital",
                                    },
                                    "reason": {
                                        "type": "string",
                                        "description": "Brief reason why this hospital is recommended",
                                    },
                                },
                                "required": ["hospital_name", "reason"],
                            },
                        },
                        {
                            "type": "client",
                            "name": "fetch_hospital_search_l1",
                            "description": (
                                "Search the web for detailed information about nearby hospitals "
                                "based on the user's triage answers. Call this AFTER all 5 triage "
                                "questions are answered. Returns search results about each hospital's "
                                "specialties, insurance, and reviews relevant to the user's situation."
                            ),
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "symptoms": {
                                        "type": "string",
                                        "description": "The user's reported symptoms from triage question 2",
                                    },
                                    "severity": {
                                        "type": "string",
                                        "description": "The severity level from triage question 3",
                                    },
                                    "duration": {
                                        "type": "string",
                                        "description": "How long symptoms have lasted from triage question 4",
                                    },
                                    "insurance": {
                                        "type": "string",
                                        "description": "The user's insurance provider from triage question 5, or 'none'",
                                    },
                                },
                                "required": ["symptoms", "severity", "duration", "insurance"],
                            },
                        },
                        {
                            "type": "client",
                            "name": "fetch_hospital_search_l2",
                            "description": (
                                "Run a refined web search to gather specific information needed "
                                "to make your final hospital recommendation. Use this AFTER "
                                "reviewing Layer 1 results and asking the user follow-up questions. "
                                "Construct a targeted search query based on everything you've learned."
                            ),
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "query": {
                                        "type": "string",
                                        "description": (
                                            "A targeted search query combining hospital name(s), "
                                            "specific conditions, and any preferences from the "
                                            "follow-up conversation"
                                        ),
                                    },
                                },
                                "required": ["query"],
                            },
                        },
                    ],
                    "built_in_tools": {
                        "end_call": {
                            "name": "end_call",
                            "params": {},
                        },
                        "language_detection": {
                            "name": "language_detection",
                            "params": {},
                        },
                    },
                },
            },
            "tts": {
                "voice_id": "EXAVITQu4vr4xnSDxMaL",  # Sarah
                "model_id": "eleven_flash_v2",
            },
            "turn": {
                "turn_eagerness": "normal",
                "turn_timeout": 10,
            },
            "conversation": {
                "max_duration_seconds": 300,
            },
        },
    )

    print(f"Agent created successfully!")
    print(f"Agent ID: {agent.agent_id}")
    print(f"\nAdd this to your .env file:")
    print(f"ELEVENLABS_AGENT_ID={agent.agent_id}")
    return agent.agent_id


def delete_all_agents_and_tools():
    """Delete all existing agents and tools from the ElevenLabs account."""
    api_key = os.getenv("ELEVENLABS_API_KEY", "")
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY not found in .env")
        return
    client = ElevenLabs(api_key=api_key)

    # Delete all agents
    print("Listing existing agents...")
    try:
        agents = client.conversational_ai.agents.list()
        agent_list = list(agents.agents) if hasattr(agents, "agents") else []
        if not agent_list:
            print("  No agents found.")
        for agent in agent_list:
            aid = agent.agent_id
            name = getattr(agent, "name", "unnamed")
            try:
                client.conversational_ai.agents.delete(agent_id=aid)
                print(f"  Deleted agent: {name} ({aid})")
            except Exception as e:
                print(f"  Failed to delete agent {name} ({aid}): {e}")
    except Exception as e:
        print(f"  Error listing agents: {e}")

    # Delete all tools via REST API
    import requests
    print("Listing existing tools...")
    try:
        r = requests.get("https://api.elevenlabs.io/v1/convai/tools", headers={"xi-api-key": api_key})
        r.raise_for_status()
        tool_list = r.json().get("tools", [])
        if not tool_list:
            print("  No tools found.")
        for tool in tool_list:
            tid = tool["id"]
            tname = tool.get("tool_config", {}).get("name", "unnamed")
            try:
                dr = requests.delete(f"https://api.elevenlabs.io/v1/convai/tools/{tid}", headers={"xi-api-key": api_key})
                if dr.status_code == 204:
                    print(f"  Deleted tool: {tname} ({tid})")
                else:
                    print(f"  Could not delete tool: {tname} ({tid}) - status {dr.status_code}")
            except Exception as e:
                print(f"  Failed to delete tool {tname} ({tid}): {e}")
    except Exception as e:
        print(f"  Error listing tools: {e}")

    print("Cleanup complete.\n")


if __name__ == "__main__":
    import sys
    if "--replace" in sys.argv:
        delete_all_agents_and_tools()
        create_agent()
    else:
        create_agent()
