FROM python:3.13-slim

RUN apt update && apt install -y git
RUN pip install aider-chat

COPY .aider.model.settings.yml .aider.model.settings.yml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]