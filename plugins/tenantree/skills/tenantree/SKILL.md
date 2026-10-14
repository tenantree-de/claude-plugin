---
name: tenantree
description: Use when the person works with SAP BTP landscapes through tenantree — choosing a landscape or system, signing in at their SAP Cloud Identity Services, checking their rights, or administering SAP BTP services (API Management, Cloud Integration, Event Mesh, HANA Cloud and others).
---

# Working with tenantree

tenantree connects you to the SAP BTP landscapes the person is assigned to in the Tenantree-Portal (https://portal.tenantree.de). The tools of the MCP server `tenantree` are the only way to act on these landscapes.

## First steps in a session

1. Call `tenantree_landscape_query` to see the assigned landscapes, the sign-in state per system and the active target.
2. If there is no active target, ask the person which system to use. Never choose one yourself.
3. Set it with `tenantree_landscape_use` only after the person has named it explicitly (for example "use QS").
4. If the person is not signed in at the IAS of that system, call `tenantree_landscape_signin` and hand over the link. Wait until the person confirms the sign-in, then call `tenantree_access_read`.

## SAP tools

Once a system is active and the person is signed in at its IAS, tenantree offers several hundred SAP tools. Their names start with the service: `btp_` (subaccount, subscriptions), `cpi_` (Cloud Integration), `apim_` (API Management), `devhub_`, `destination_`, `connectivity_`, `eventmesh_`, `hana_`, `servicemanager_`, `xsuaa_`, plus `runbook_` (several steps in one approved plan) and `tenantree_` (diagrams, costs, catalog, plans).

- Find tools by searching for the service and the object, e.g. "cpi messagelog", "apim proxy", "destination update", "idempotent".
- Overview of a landscape: `tenantree_diagram_read` (kind "tenant"). Costs and cost risks: `tenantree_cost_query`. The full list of tools: `tenantree_catalog_query`.
- Failed messages: `cpi_messagelog_query` (filter by integration flow and time), then `cpi_messagelog_read` for the error details. Explain the cause and name concrete solutions.
- Every change is first a plan. The person approves it with the Approve button on the card (or on the approval page). Never call a tool with `confirmed=true` on your own.
- Passwords and other secrets are set through a one-time link that tenantree shows after the approval (e.g. `destination_destination_update` with `newPassword`, `cpi_usercredential_update`). Never ask for them in the chat.
- If a tool is rejected for a missing right, quote the right and the SAP standard role collection that grants it.

## Rules

- Exactly one active target. Name it in every answer that concerns the landscape. Switch only on an explicit request of the person.
- Production systems: before any change, name the system and ask for an explicit confirmation, even if the person has already approved similar changes on other systems.
- The rights come from the customer's SAP Cloud Identity Services and SAP BTP. If tenantree reports "read" or "no access", do not look for workarounds; explain which IAS group or role is missing and that an administrator of the customer assigns it.
- Never ask for passwords, client secrets or service keys in the chat. Secrets are exchanged only through the one-time links tenantree provides.
- If the sign-in at tenantree itself fails, the person runs `/mcp`, selects the server `tenantree` and signs in again.
