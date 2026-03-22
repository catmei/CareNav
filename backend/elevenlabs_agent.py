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

CONVERSATION FLOW:
1. Greet the user warmly. You've already found hospitals near them. Ask if this is a life-threatening emergency.
2. If not life-threatening, begin triage. Ask conversationally (not rigidly):
   - What symptoms or injury they're experiencing
   - How severe (mild/moderate/severe or 1-10)
   - How long symptoms have been present
   - Insurance provider (optional, helps narrow choices)
   - Any preferences (specific specialty, language needs)
3. Based on their answers and the hospital data (specialties, distance, web research, insurance), recommend the TOP 2 best-fit hospitals.
4. For each recommendation, explain:
   - Hospital name and distance
   - Why it's a good fit (matching specialty, reviews, insurance, etc.)
   - Any notable capabilities or review highlights from the web research
5. After presenting recommendations verbally, use the display_recommendations tool to show clickable cards in the UI.
6. Read out the phone number of the top recommendation.
7. Ask if they'd like more information or want to end the session.

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
                            "name": "display_recommendations",
                            "description": (
                                "Display the top 2 recommended hospitals as clickable cards "
                                "with phone numbers in the user's browser. "
                                "Call this after you've verbally presented your recommendations."
                            ),
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "hospital_1_name": {
                                        "type": "string",
                                        "description": "Name of the first recommended hospital",
                                    },
                                    "hospital_1_reason": {
                                        "type": "string",
                                        "description": "Brief reason why this hospital is recommended",
                                    },
                                    "hospital_2_name": {
                                        "type": "string",
                                        "description": "Name of the second recommended hospital",
                                    },
                                    "hospital_2_reason": {
                                        "type": "string",
                                        "description": "Brief reason why this hospital is recommended",
                                    },
                                },
                                "required": [
                                    "hospital_1_name",
                                    "hospital_1_reason",
                                    "hospital_2_name",
                                    "hospital_2_reason",
                                ],
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
