---
name: tenantree
description: Use when the person works with SAP BTP landscapes through tenantree — choosing a subaccount, signing in at their SAP Cloud Identity Services, checking their rights, or administering SAP BTP services (API Management, Cloud Integration, Event Mesh, HANA Cloud and others).
---

# Working with tenantree

tenantree connects you to the SAP BTP subaccounts the person is assigned to in the Tenantree-Portal (https://portal.tenantree.de). The structure is Landscape (the customer's top level in tenantree) → Global Account (SAP BTP) → Subaccount; the tool parameters name them `landscape`, `globalAccount` and `subaccount`. The tools of the MCP server `tenantree` are the only way to act on these subaccounts.

Two views of global accounts and subaccounts, and which tool answers which question:

- What the person may work on in tenantree (assignment in the Tenantree-Portal, IAS sign-in, right): `tenantree_landscape_query` (landscapes with their global accounts and subaccounts), `tenantree_globalaccount_query`, `tenantree_subaccount_query` (optionally with `globalAccount`).
- What exists in SAP BTP, read from SAP regardless of tenantree: `btp_subaccount_query` (every subaccount of the global account), `btp_globalaccount_read`. These need the account level and say nothing about the person's assignment in tenantree.

## First steps in a session

1. Call `tenantree_landscape_query` to see the assigned subaccounts, the sign-in state per subaccount and the active target.
2. If there is no active target, ask the person which subaccount to use. Never choose one yourself.
3. Set it with `tenantree_landscape_use` only after the person has named it explicitly (for example "use QS"): parameter `subaccount` (with `globalAccount` if the name is ambiguous) or `subaccountId`.
4. If the person is not signed in at the IAS of that subaccount, call `tenantree_landscape_signin` and hand over the link. Wait until the person confirms the sign-in, then call `tenantree_access_read`.

## Rules

- Exactly one active target. Name it in every answer that concerns the subaccount. Switch only on an explicit request of the person.
- Production subaccounts: before any change, name the subaccount and ask for an explicit confirmation, even if the person has already approved similar changes on other subaccounts.
- The rights come from the customer's SAP Cloud Identity Services and SAP BTP. If tenantree reports "read" or "no access", do not look for workarounds; explain which IAS group or role is missing and that an administrator of the customer assigns it.
- Never ask for passwords, client secrets or service keys in the chat. Secrets are exchanged only through the one-time links tenantree provides.
- If the sign-in at tenantree itself fails, the person runs `/mcp`, selects the server `tenantree` and signs in again.

## Account commands in the chat

- "tenantree login": call `tenantree_landscape_query`. If there is no active target and exactly one subaccount is listed, set it with `tenantree_landscape_use` (agreed for the single-subaccount case); with several, ask which one. If the person is not signed in at the IAS of the active target, call `tenantree_landscape_signin` and give the link. Answer briefly: account, active target, IAS sign-in state. If the tenantree tools are not available, tell the person to run `/mcp`, select `tenantree` and choose Authenticate, then to write "tenantree login" again.
- "tenantree logout" or "Sign me out of tenantree": call `tenantree_session_delete` once and confirm in one sentence.
