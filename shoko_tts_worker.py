import os
import sys
import io
import json
import time
import wave
import hashlib
from google import genai
from google.genai import types

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def load_env_manual(filepath):
    if not os.path.exists(filepath):
        return
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CANDIDATE_ENVS = [
    os.path.abspath(os.path.join(BASE_DIR, "../../🤖_AgentTools/Scripts/.env")),
    os.path.abspath(os.path.join(BASE_DIR, "../../../AgentTools/Scripts/.env")),
    r"C:\Users\mattu\Documents\MyProjects\🤖_AgentTools\Scripts\.env",
    r"C:\Users\mattu\Documents\AgentTools\Scripts\.env",
]
for ep in CANDIDATE_ENVS:
    if os.path.exists(ep):
        load_env_manual(ep)
        break

project_id = (
    os.getenv("PERSONAL_AI_PROJECT_ID")
    or os.getenv("CONSTRUCTION_GCP_PROJECT_ID")
    or os.getenv("VERTEX_AI_PROJECT_ID")
)

credentials_path = (
    os.getenv("PERSONAL_AI_CREDENTIALS")
    or os.getenv("CONSTRUCTION_GOOGLE_APPLICATION_CREDENTIALS")
    or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
)

CANDIDATE_KEYS = [
    r"C:\Users\mattu\Documents\MyProjects\🤖_AgentTools\Scripts\Config\personal_key.json",
    r"C:\Users\mattu\Documents\MyProjects\🤖_AgentTools\Config\personal_key.json",
    r"C:\Users\mattu\Documents\AgentTools\Scripts\Config\personal_key.json",
    r"C:\AgentTools\Config\personal_key.json",
]
if not credentials_path or not os.path.exists(credentials_path):
    for kp in CANDIDATE_KEYS:
        if os.path.exists(kp):
            credentials_path = kp
            break

if credentials_path and os.path.exists(credentials_path):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

VOICE_NAME = "Leda"  # ショウコさんボイス
MODELS = [
    "gemini-3.8-flash-tts",
    "gemini-3.8-flash-lite-tts",
    "gemini-2.5-flash-tts",
]

vertex_client = None
if project_id:
    vertex_client = genai.Client(vertexai=True, project=project_id, location="global")

aistudio_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
aistudio_client = genai.Client(api_key=aistudio_key) if aistudio_key else None

LAST_CALL_TS = 0.0
MIN_INTERVAL = 1.6


def extract_pcm(audio_bytes):
    if not audio_bytes:
        return b""
    if audio_bytes[:4] == b"RIFF":
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            pcm = wf.readframes(wf.getnframes())
    else:
        pcm = audio_bytes
    if len(pcm) % 2 != 0:
        pcm = pcm[:-1]
    return pcm


def write_wav_24k(pcm_bytes, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp_path = out_path + ".tmp"
    with wave.open(tmp_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm_bytes)
    os.replace(tmp_path, out_path)


def synthesize_to_wav(text, out_path):
    global LAST_CALL_TS
    if os.path.exists(out_path) and os.path.getsize(out_path) > 200:
        return True, "cached"

    speech_cfg = types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE_NAME)
        )
    )
    gen_cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=speech_cfg,
    )

    # ショウコさん（Leda）そのままの自然な声でセリフのみを合成
    prompt_text = text

    clients = []
    if aistudio_client:
        clients.append(("aistudio", aistudio_client, ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]))
    if vertex_client:
        clients.append(("vertex", vertex_client, MODELS))

    last_err = "No GenAI client configured"
    for provider_name, cli, model_list in clients:
        for mdl in model_list:
            try:
                elapsed = time.time() - LAST_CALL_TS
                if elapsed < MIN_INTERVAL:
                    time.sleep(MIN_INTERVAL - elapsed)
                LAST_CALL_TS = time.time()

                resp = cli.models.generate_content(
                    model=mdl,
                    contents=prompt_text,
                    config=gen_cfg,
                )
                part = resp.candidates[0].content.parts[0]
                if part.inline_data and part.inline_data.data:
                    pcm = extract_pcm(part.inline_data.data)
                    if pcm:
                        write_wav_24k(pcm, out_path)
                        return True, f"{provider_name}:{mdl}"
                last_err = "Empty audio payload"
            except Exception as e:
                last_err = f"{provider_name}:{mdl} -> {e}"
                continue

    return False, last_err


def main():
    print(json.dumps({"ready": True, "voice": VOICE_NAME, "project": bool(project_id)}), flush=True)
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            req = json.loads(raw_line)
            req_id = req.get("id", "")
            text = req.get("text", "").strip()
            out_path = req.get("out", "")
            if not text or not out_path:
                print(json.dumps({"id": req_id, "ok": False, "error": "missing text or out"}), flush=True)
                continue
            ok, info = synthesize_to_wav(text, out_path)
            print(json.dumps({"id": req_id, "ok": ok, "info": info}), flush=True)
        except Exception as exc:
            print(json.dumps({"id": "", "ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
