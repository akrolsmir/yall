// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
      // Flip in the Instant dashboard to grant admin access
      isAdmin: i.boolean().optional(),
    }),
    // Light row per person — the homepage table loads all of these, so keep
    // long-form content out of this entity (it lives in `profiles`).
    people: i.entity({
      name: i.string().indexed(),
      slug: i.string().unique().indexed(),
      email: i.string().optional().indexed(),
      bio: i.string().optional(), // one sentence
      primaryOrg: i.string().optional().indexed(),
      otherOrgs: i.json<string[]>().optional(),
      tags: i.json<string[]>().optional(), // plaintext field affiliations
      // none | queued | generating | generated | failed
      status: i.string().indexed(),
      // Free-text hint for the research agent ("LinkedIn: …", "runs X at Y")
      context: i.string().optional(),
      humanEdited: i.boolean().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().optional(),
    }),
    // Long-form generated/edited content, one per person
    profiles: i.entity({
      summary: i.string().optional(), // couple paragraphs
      article: i.string().optional(), // ~1000-word wikipedia-style, markdown
      links: i.json<{ label: string; url: string }[]>().optional(),
      generatedAt: i.number().optional(),
      model: i.string().optional(),
    }),
    // One per CSV upload, for provenance ("attendees of Manifest 2025")
    sources: i.entity({
      description: i.string(),
      createdAt: i.number().indexed(),
    }),
    // One per profile-generation attempt; trace streams to the UI live
    runs: i.entity({
      mode: i.string(), // fast | deep
      status: i.string().indexed(), // running | done | failed
      trace: i.json<{ t: number; kind: string; text: string }[]>().optional(),
      error: i.string().optional(),
      createdAt: i.number().indexed(),
      finishedAt: i.number().optional(),
    }),
    // AI chat threads, one per conversation on /chat
    chats: i.entity({
      title: i.string(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed(),
    }),
    // One per chat turn. Assistant replies stream in via the admin SDK:
    // content/trace update live while status === 'streaming'.
    messages: i.entity({
      role: i.string(), // user | assistant
      content: i.string(),
      status: i.string(), // done | streaming | failed
      error: i.string().optional(),
      model: i.string().optional(),
      trace: i.json<{ t: number; kind: string; text: string }[]>().optional(),
      createdAt: i.number().indexed(),
    }),
    // Per-user outreach voice: how they write, and who they know
    voiceProfiles: i.entity({
      styleNotes: i.string().optional(),
      writingSamples: i.string().optional(),
      network: i.string().optional(),
      updatedAt: i.number().optional(),
    }),
    // Claim requests that need admin approval (no email match)
    claims: i.entity({
      status: i.string().indexed(), // pending | approved | rejected
      requesterEmail: i.string().optional(),
      message: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
  },
  links: {
    $usersLinkedPrimaryUser: {
      forward: {
        on: "$users",
        has: "one",
        label: "linkedPrimaryUser",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "linkedGuestUsers",
      },
    },
    personProfile: {
      forward: { on: "people", has: "one", label: "profile" },
      reverse: { on: "profiles", has: "one", label: "person" },
    },
    personSources: {
      forward: { on: "people", has: "many", label: "sources" },
      reverse: { on: "sources", has: "many", label: "people" },
    },
    personClaimedBy: {
      forward: { on: "people", has: "one", label: "claimedBy" },
      reverse: { on: "$users", has: "many", label: "claimedPeople" },
    },
    runPerson: {
      forward: { on: "runs", has: "one", label: "person" },
      reverse: { on: "people", has: "many", label: "runs" },
    },
    chatOwner: {
      forward: { on: "chats", has: "one", label: "owner", onDelete: "cascade" },
      reverse: { on: "$users", has: "many", label: "chats" },
    },
    messageChat: {
      forward: {
        on: "messages",
        has: "one",
        label: "chat",
        onDelete: "cascade",
      },
      reverse: { on: "chats", has: "many", label: "messages" },
    },
    voiceProfileOwner: {
      forward: {
        on: "voiceProfiles",
        has: "one",
        label: "owner",
        onDelete: "cascade",
      },
      reverse: { on: "$users", has: "one", label: "voiceProfile" },
    },
    claimPerson: {
      forward: { on: "claims", has: "one", label: "person" },
      reverse: { on: "people", has: "many", label: "claims" },
    },
    claimUser: {
      forward: { on: "claims", has: "one", label: "user" },
      reverse: { on: "$users", has: "many", label: "claims" },
    },
  },
  rooms: {},
});

// This helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
