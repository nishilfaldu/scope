import { providerName } from "./connectors";

// Provider scope names in plain language. Unknown scopes show their raw name.
const plain: Record<string, Record<string, string>> = {
  slack: {
    "app_mentions:read": "See messages that mention the app",
    "bookmarks:read": "See channel bookmarks",
    "canvases:read": "Read canvases",
    "canvases:write": "Create and edit canvases",
    "channels:history": "Read messages in public channels",
    "channels:join": "Join public channels",
    "channels:manage": "Manage public channels",
    "channels:read": "See public channels",
    "chat:write": "Send messages",
    "chat:write.public": "Send messages to channels it is not in",
    "emoji:read": "See custom emoji",
    "files:read": "See files",
    "files:write": "Upload, edit and delete files",
    "groups:history": "Read messages in private channels",
    "groups:read": "See private channels",
    "im:history": "Read direct messages",
    "im:read": "See direct message conversations",
    "im:write": "Start direct messages",
    "links:read": "See links in messages",
    "mpim:history": "Read group direct messages",
    "mpim:read": "See group direct message conversations",
    "pins:read": "See pinned messages",
    "reactions:read": "See emoji reactions",
    "reactions:write": "Add and remove emoji reactions",
    "reminders:read": "See reminders",
    "search:read": "Search the workspace",
    "search:read.im": "Search direct messages",
    "search:read.mpim": "Search group direct messages",
    "search:read.private": "Search private channels",
    "search:read.public": "Search public channels",
    "search:read.users": "Search members",
    "team:read": "See workspace name and domain",
    "usergroups:read": "See user groups",
    "users.profile:read": "See member profiles",
    "users:read": "See members",
    "users:read.email": "See member email addresses",
  },
};

export function describeScope(providerId: string, scope: string) {
  return plain[providerId]?.[scope] ?? scope;
}

export function unreportedPermissions(providerId: string) {
  return `Permissions were set on ${providerName(providerId)}'s consent screen.`;
}
