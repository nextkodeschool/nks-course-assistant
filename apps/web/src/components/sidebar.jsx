import { useMemo, useState } from "react";
import { LogOut, Plus, Search, X } from "lucide-react";
import { Wordmark } from "./brand";

/**
 * Conversation navigation.
 *
 * Kept to what the product actually has: start a conversation, find an old
 * one, switch, delete, sign out. No settings panel, no usage meter, no
 * counters -- inventing chrome to fill a sidebar is how this stops looking
 * like a tool and starts looking like a dashboard.
 *
 * Search filters client-side over titles already loaded. It is not a new
 * backend capability, and it only appears once there are enough
 * conversations for scanning to be slower than typing.
 */

const SEARCH_THRESHOLD = 6;

export function Sidebar({
  open,
  onClose,
  user,
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onSignOut,
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const initials = (user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-head">
        <Wordmark />
      </div>

      <div className="sidebar-actions">
        <button className="btn" onClick={onCreate}>
          <Plus size={14} strokeWidth={2} />
          New conversation
        </button>

        {conversations.length >= SEARCH_THRESHOLD && (
          <div className="search">
            <Search size={13} strokeWidth={2} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
          </div>
        )}
      </div>

      <nav className="convo-scroll" aria-label="Conversations">
        <div className="convo-group">
          <span className="label">
            {query ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : "Recent"}
          </span>

          {filtered.length === 0 && (
            <p className="convo-empty">{query ? "Nothing matches." : "No conversations yet."}</p>
          )}

          {filtered.map((c) => (
            <div key={c.id} className={`convo-item ${c.id === activeId ? "active" : ""}`}>
              <button
                className="open"
                onClick={() => {
                  onSelect(c.id);
                  onClose?.();
                }}
                title={c.title}
              >
                {c.title}
              </button>
              <button
                className="remove"
                onClick={() => onDelete(c.id)}
                aria-label={`Delete conversation: ${c.title}`}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </nav>

      <div className="sidebar-foot">
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="email" title={user?.email}>
          {user?.email}
        </span>
        <button className="btn-quiet" onClick={onSignOut} aria-label="Sign out">
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}
