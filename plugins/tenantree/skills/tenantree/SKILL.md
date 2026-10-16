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

## Rules

- Exactly one active target. Name it in every answer that concerns the landscape. Switch only on an explicit request of the person.
- Production systems: before any change, name the system and ask for an explicit confirmation, even if the person has already approved similar changes on other systems.
- The rights come from the customer's SAP Cloud Identity Services and SAP BTP. If tenantree reports "read" or "no access", do not look for workarounds; explain which IAS group or role is missing and that an administrator of the customer assigns it.
- Never ask for passwords, client secrets or service keys in the chat. Secrets are exchanged only through the one-time links tenantree provides.
- If the sign-in at tenantree itself fails, the person runs `/mcp`, selects the server `tenantree` and signs in again.

## Account commands in the chat

- "tenantree login": call `tenantree_landscape_query` once and answer in one sentence with the signed-in account and the active target. The call connects tenantree and updates the tenantree band. If the tenantree tools are not available, tell the person to run `/mcp`, select `tenantree` and choose Authenticate, then to write "tenantree login" again.
- "tenantree logout" or "Sign me out of tenantree": call `tenantree_session_delete` once and confirm in one sentence.
