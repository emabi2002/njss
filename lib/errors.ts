const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/insufficient available budget/i, "Insufficient available budget for this request. Reduce the amount or request an additional release before continuing."],
  [/insufficient Available Budget/i, "Insufficient available budget for this request. Reduce the amount or request an additional release before continuing."],
  [/BUDGET_MAPPING_REQUIRED.*Multiple/i, "This requisition matches more than one approved budget line. Select the exact budget line before continuing."],
  [/BUDGET_MAPPING_REQUIRED/i, "No exact approved budget line could be found for this requisition. Check the financial year, department, section, cost centre, funding source and expense code."],
  [/duplicate original commitment/i, "A commitment already exists for this FF3. Duplicate commitments are not allowed."],
  [/already has a payment transaction|duplicate payment/i, "This FF4 already has a recorded payment. Duplicate payments are not allowed."],
  [/exceeds available commitment balance|exceeds remaining commitment|exceeds the remaining commitment/i, "The FF4 amount exceeds the remaining commitment balance."],
  [/Supplier mismatch/i, "The FF4 supplier must match the supplier attached to the selected commitment."],
  [/Segregation of duties/i, "Segregation-of-duties rules prevent this user from performing the requested approval."],
  [/Creator cannot be the final approver/i, "The creator cannot be the final approver for this transaction."],
  [/Only DRAFT FF4 can be submitted/i, "Only a draft FF4 can be submitted."],
  [/Only SUBMITTED FF4 can be verified/i, "Only a submitted FF4 can be verified."],
  [/Only VERIFIED FF4 can be approved/i, "Only a verified FF4 can be approved."],
  [/Only APPROVED FF4 can be processed/i, "Only an approved FF4 can be processed."],
  [/Only PROCESSED FF4 can be marked paid/i, "Only a processed FF4 can be marked paid."],
  [/Only PAID FF4 can be reconciled/i, "Only a paid FF4 can be reconciled."],
  [/Access denied\. Required permission:/i, "You do not have permission to perform this action."],
]

export function toUserMessage(error: unknown, fallback = "The requested operation could not be completed.") {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  for (const [pattern, message] of MESSAGE_RULES) {
    if (pattern.test(raw)) return message
  }
  return raw || fallback
}
