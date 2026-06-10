// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const rules = {
  $users: {
    allow: {
      view: "auth.id == data.id",
    },
  },
  people: {
    allow: {
      view: "true",
      create: "isAdmin",
      // Admins, the profile's claimer, or an email-matched user claiming an
      // unclaimed profile (the claim link itself is set server-side)
      update:
        "isAdmin || isClaimer || (auth.email != null && auth.email == data.email && data.ref('claimedBy.id') == [])",
      delete: "isAdmin",
    },
    bind: [
      "isAdmin",
      "auth.ref('$user.isAdmin')[0] == true",
      "isClaimer",
      "auth.id in data.ref('claimedBy.id')",
    ],
  },
  profiles: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin || auth.id in data.ref('person.claimedBy.id')",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.ref('$user.isAdmin')[0] == true"],
  },
  runs: {
    // Written only via the admin SDK in API routes; public read for the trace
    allow: {
      view: "true",
      create: "false",
      update: "false",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.ref('$user.isAdmin')[0] == true"],
  },
  sources: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.ref('$user.isAdmin')[0] == true"],
  },
  claims: {
    allow: {
      view: "isAdmin || auth.id in data.ref('user.id')",
      create: "auth.id != null && auth.id in data.ref('user.id')",
      update: "isAdmin",
      delete: "isAdmin || auth.id in data.ref('user.id')",
    },
    bind: ["isAdmin", "auth.ref('$user.isAdmin')[0] == true"],
  },
} satisfies InstantRules;

export default rules;
