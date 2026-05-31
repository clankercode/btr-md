import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExternalConfirmationModel,
  deriveTrustStatus,
  describeResourcePolicy,
} from "./resource_policy.ts";
import type {
  DocumentIssue,
  ResourceDecision,
  ResourcePolicyReport,
} from "./document_contracts.ts";

function emptyResourcePolicyReport(doc_id: number, version: number): ResourcePolicyReport {
  return { doc_id, version, allowed_roots: [], loaded_resources: [], decisions: [] };
}

function issue(
  id: string,
  severity: DocumentIssue["severity"],
  category: DocumentIssue["category"],
): DocumentIssue {
  return {
    id,
    severity,
    category,
    message: "Remote image blocked",
    line_start: 3,
    line_end: 3,
    block_id: null,
    detail: null,
    primary_action: null,
  };
}

function decision(decisionValue: ResourceDecision["decision"]): ResourceDecision {
  return {
    source_target: "https://example.com/image.png",
    normalized_target: "https://example.com/image.png",
    line_start: 3,
    line_end: 3,
    kind: "image",
    decision: decisionValue,
    reason: "remote_blocked",
    safe_url: null,
    placeholder_id: "image-1",
    alt_text: "remote",
  };
}

test("trust status distinguishes clean and blocked documents", () => {
  assert.equal(deriveTrustStatus(emptyResourcePolicyReport(1, 1), []), "Safe Preview");
  assert.equal(
    deriveTrustStatus(emptyResourcePolicyReport(1, 1), [
      issue("image-1", "blocked", "resource_policy"),
    ]),
    "Content Blocked",
  );
});

test("blocked resource decisions drive blocked trust status", () => {
  const report = emptyResourcePolicyReport(1, 1);
  report.decisions = [decision("blocked")];

  assert.equal(deriveTrustStatus(report, []), "Content Blocked");
});

test("missing resources do not imply content is blocked", () => {
  const report = emptyResourcePolicyReport(1, 1);
  report.decisions = [decision("missing")];

  assert.equal(deriveTrustStatus(report, [issue("image-1", "error", "image")]), "Safe Preview");
});

test("resource policy panel lists active restrictions", () => {
  const rows = describeResourcePolicy(emptyResourcePolicyReport(1, 1));

  assert.deepEqual(
    rows.map((row) => row.label),
    [
      "Raw HTML stripped",
      "Scripts disabled",
      "Remote images blocked",
      "Local images scoped",
      "Mermaid strict",
      "KaTeX untrusted",
    ],
  );
  assert.deepEqual([...new Set(rows.map((row) => row.status))], ["enabled"]);
});

test("resource policy panel lists allowed roots", () => {
  const report = emptyResourcePolicyReport(1, 1);
  report.allowed_roots = ["/home/me/docs", "/home/me/assets"];

  assert.deepEqual(describeResourcePolicy(report).slice(-2), [
    { label: "/home/me/docs", status: "allowed_root" },
    { label: "/home/me/assets", status: "allowed_root" },
  ]);
});

test("external confirmation exposes normalized destination context", () => {
  const model = buildExternalConfirmationModel({
    normalized_url: "https://example.com/path?q=1",
    scheme: "https",
    host: "example.com",
    label_text: "Download report",
  });

  assert.equal(model.normalizedUrl, "https://example.com/path?q=1");
  assert.equal(model.scheme, "https");
  assert.equal(model.host, "example.com");
  assert.equal(model.labelText, "Download report");
});
