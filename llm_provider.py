import requests
from typing import Any, List, Optional, Mapping
from langchain_core.language_models.llms import LLM
from langchain_core.callbacks.manager import CallbackManagerForLLMRun


class ConnectAPILLM(LLM):
    authenticator: Any
    provider: str = "OpenAI"
    model: str = "gpt-4-32k"
    temperature: float = 0.5

    class Config:
        arbitrary_types_allowed = True

    @property
    def _llm_type(self) -> str:
        return "salesforce_connect_api"

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        if not self.authenticator.authenticated:
            self.authenticator.authenticate()

        url = (
            self.authenticator.org_url
            + "/services/data/v62.0/einstein/llm/prompt/generations"
        )

        payload = {
            "promptTextorId": prompt,
            "provider": self.provider,
            "modelParams": {
                "modelName": self.model,
                "temperature": self.temperature,
                "maxTokens": 16384,
            },
        }

        headers = {
            "Authorization": f"Bearer {self.authenticator.access_token}",
            "Content-Type": "application/json",
        }

        response = requests.post(url, json=payload, headers=headers)

        if response.status_code == 401:
            self.authenticator.authenticate()
            headers["Authorization"] = f"Bearer {self.authenticator.access_token}"
            response = requests.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            raise Exception(
                f"Einstein API error: {response.status_code} - {response.text}"
            )

        data = response.json()

        if "generations" in data and len(data["generations"]) > 0:
            return data["generations"][0].get("text", "")

        if "generation" in data:
            gen = data["generation"]
            if isinstance(gen, dict):
                return gen.get("generatedText", gen.get("text", ""))
            return str(gen)

        return str(data)

    @property
    def _identifying_params(self) -> Mapping[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "temperature": self.temperature,
        }
