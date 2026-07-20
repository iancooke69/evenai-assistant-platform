import { createAssistantHttpHandler } from "../../packages/http-adapter/index.mjs";
import { askGgcAssistant } from "./index.mjs";

export const GGC_ASSISTANT_ROUTE = "/api/assistant/v1/assist";

export const handleGgcAssistantRequest = createAssistantHttpHandler({
  assistant: askGgcAssistant,
  route: GGC_ASSISTANT_ROUTE,
  maximumInputLength: 2000,
});
