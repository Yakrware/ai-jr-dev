FROM python:3.12-slim

RUN apt update && apt install -y git
RUN pip install aider-chat pypatch

COPY claim-aider-traffic.patch claim-aider-traffic.patch

RUN pypatch apply claim-aider-traffic.patch aider.llm

COPY .aider.model.settings.yml .aider.model.settings.yml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]