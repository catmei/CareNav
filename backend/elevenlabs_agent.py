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

YOU ALREADY KNOW THE NEARBY HOSPITALS (JSON data):
{{hospitals_data}}

CONVERSATION FLOW — TRIAGE PHASE:
You MUST ask these 5 questions one at a time. After the user answers each question, IMMEDIATELY call the update_triage_card tool to update the corresponding card in the UI before asking the next question.

Question 1 (card_number=1, label="Emergency Check"):
  Ask: "First, is this a life-threatening emergency? For example, chest pain, difficulty breathing, severe bleeding, or loss of consciousness?"
  → If YES: tell them to call 911 immediately, update card with answer="Yes - Call 911", and end.
  → If NO: update card with their answer (e.g. "No, not life-threatening") and proceed.

Question 2 (card_number=2, label="Symptoms"):
  Ask: "What symptoms or injury are you experiencing?"
  → Update card with a brief summary of their symptoms.

Question 3 (card_number=3, label="Severity"):
  Ask: "On a scale of 1 to 10, how severe would you say it is?"
  → Update card with their severity level (e.g. "7/10 - Moderate to severe").

Question 4 (card_number=4, label="Duration"):
  Ask: "How long have you been experiencing this?"
  → Update card with duration (e.g. "Since yesterday", "2 hours").

Question 5 (card_number=5, label="Insurance"):
  Ask: "Do you have an insurance provider? This is optional but helps narrow choices."
  → Update card with their answer (e.g. "Blue Cross" or "No insurance / Skipped").

IMPORTANT: Call update_triage_card EVERY time you get an answer. Do not batch them. Call it immediately after each answer before moving to the next question.

TRANSITION PHASE:
After the user answers Question 5 (Insurance):
1. IMMEDIATELY call update_triage_card for card 5 with their answer.
2. THEN say something like: "Great, thank you for all that information. Let me review the nearby hospitals and find the best match for you. Just one moment."
3. WAIT for the user to acknowledge (e.g. "okay", "sure", "go ahead") before proceeding to the Recommendation Phase.

RECOMMENDATION PHASE:
After the user acknowledges the transition:
1. Based on their answers and the hospital data (specialties, distance, web research, insurance), choose the single BEST-FIT hospital.
2. FIRST, call the display_recommendation tool to show the hospital card in the UI BEFORE you speak about it.
3. THEN verbally tell the user your recommendation:
   - Hospital name and distance
   - Why it's the best fit (matching specialty, reviews, insurance, etc.)
   - Any notable capabilities or review highlights from the web research
   - Read out the phone number
4. Ask if they'd like more information or want to end the session.

GUIDELINES:
- Keep responses concise — this is voice, not text. Short sentences.
- Be warm and reassuring, not clinical.
- If the user seems distressed, acknowledge their feelings first.
- If you don't have enough info to differentiate hospitals, favor the closest one.
- Always mention distance in your recommendations.
- When recommending, reference specific details from the web research (reviews, ratings, specialties found online).
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
                    "Hello, I'm your emergency hospital finder assistant. "
                    "I've already located hospitals near you. "
                    "Before we begin, is this a life-threatening emergency? "
                    "If so, please hang up and call 911 immediately."
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
                                        "description": "Which triage card to update (1-5): 1=Emergency Check, 2=Symptoms, 3=Severity, 4=Duration, 5=Insurance",
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
                        }
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


if __name__ == "__main__":
    create_agent()
