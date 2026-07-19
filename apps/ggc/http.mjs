import { createAssistantHttpHandler } from "../../packages/http-adapter/index.mjs";
import { askGgcAssistant } from "./index.mjs";

export const handleGgcAssistantRequest = createAssistantHttpHandler({
  assistant: askGgcAssistant,
  route: "/v1/assist",
  maximumInputLength: 2000,
});
