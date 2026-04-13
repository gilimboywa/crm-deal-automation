import { getAnthropicClient } from "../lib/anthropic.js";
import {
  DEAL_EXTRACTION_SYSTEM_PROMPT,
  DEAL_BOX_TOOL,
  buildUserPrompt,
} from "../lib/prompts.js";
import type { DealBox, ProcessingInput } from "../lib/types.js";

export interface ProcessingResult {
  dealBox: DealBox;
  reasoning: string;
}

export async function processDealData(
  input: ProcessingInput
): Promise<ProcessingResult> {
  const userPrompt = buildUserPrompt(input.sourceType, input.data);

  try {
    const response = await getAnthropicClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: DEAL_EXTRACTION_SYSTEM_PROMPT,
      tools: [DEAL_BOX_TOOL as any],
      tool_choice: { type: "tool", name: "create_deal_box" },
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the tool_use block from the response
    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      throw new Error(
        "Claude did not return a tool_use response. Response: " +
          JSON.stringify(response.content)
      );
    }

    const rawInput = toolUseBlock.input as Record<string, any>;

    // Extract reasoning before building the DealBox
    const reasoning = (rawInput.reasoning as string) || "";

    // Map the tool response to a DealBox
    const dealBox: DealBox = {
      companyName: rawInput.companyName,
      amount: rawInput.amount ?? null,
      closeDate: rawInput.closeDate ?? null,
      pipeline: rawInput.pipeline || "[NEW] Sales Pipeline",
      dealStage: rawInput.dealStage || "0",
      dealSourcePerson: rawInput.dealSourcePerson ?? null,
      primaryDealSource: rawInput.primaryDealSource ?? null,
      dealSourceDetails: rawInput.dealSourceDetails ?? null,
      dealDescription: rawInput.dealDescription ?? null,
      icp: rawInput.icp ?? null,
      dealType: rawInput.dealType ?? null,
      createDate: rawInput.createDate || new Date().toISOString(),
      lastContacted: rawInput.lastContacted ?? null,
      dealOwner: rawInput.dealOwner ?? null,
      forecastProbability: rawInput.forecastProbability ?? null,
      numCustomerAccounts: rawInput.numCustomerAccounts ?? null,
      numStateReports: rawInput.numStateReports ?? null,
      numDueDiligenceLetters: rawInput.numDueDiligenceLetters ?? null,
      contractTerm: rawInput.contractTerm ?? null,
      disbursementPricing: rawInput.disbursementPricing ?? null,
      escheatmentPricing: rawInput.escheatmentPricing ?? null,
      dollarValuePerItem: rawInput.dollarValuePerItem ?? null,
      annualPlatformFee: rawInput.annualPlatformFee ?? null,
      implementationFee: rawInput.implementationFee ?? null,
      numEscheatmentsPerYear: rawInput.numEscheatmentsPerYear ?? null,
      associatedContacts: Array.isArray(rawInput.associatedContacts)
        ? rawInput.associatedContacts.map((c: any) => ({
            firstName: c.firstName,
            lastName: c.lastName ?? null,
            email: c.email ?? null,
            title: c.title ?? null,
            company: c.company ?? null,
            associationReason: c.associationReason ?? null,
            firstSeenDate: c.firstSeenDate ?? null,
            role: c.role === "primary" ? "primary" : "secondary",
          }))
        : [],
    };

    return { dealBox, reasoning };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Deal processing failed: ${error.message}`);
    }
    throw new Error("Deal processing failed with an unknown error");
  }
}
