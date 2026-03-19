from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.shared.exceptions import AppException, app_exception_handler

app = FastAPI(
    title="Crewmatic API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppException, app_exception_handler)


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
