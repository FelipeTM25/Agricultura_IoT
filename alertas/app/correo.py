"""Envio de las alertas por correo (SMTP; por defecto el de Gmail)."""
import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage

from . import config

log = logging.getLogger("uvicorn.error")


def configurado() -> bool:
    return bool(config.SMTP_USUARIO and config.SMTP_PASSWORD and config.CORREO_DESTINO)


def _enviar(asunto: str, texto: str) -> None:
    mensaje = EmailMessage()
    mensaje["Subject"] = asunto
    mensaje["From"] = f"Agricultura IoT <{config.SMTP_USUARIO}>"
    mensaje["To"] = ", ".join(config.CORREO_DESTINO)
    mensaje.set_content(texto)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(config.SMTP_USUARIO, config.SMTP_PASSWORD)
        smtp.send_message(mensaje)


async def enviar(asunto: str, texto: str) -> bool:
    """Manda el correo a CORREO_DESTINO. Devuelve si el servidor SMTP lo acepto."""
    if not configurado():
        return False
    try:
        # smtplib es bloqueante: se corre en otro hilo para no frenar las notificaciones de Orion
        await asyncio.to_thread(_enviar, asunto, texto)
    except (smtplib.SMTPException, OSError) as e:
        log.error("No se pudo enviar el correo de alerta: %s", e)
        return False
    return True
