import { useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Wordmark } from "./brand";
import { Menu } from "./menu";

/**
 * Conversation navigation.
 *
 * Kept to what the product actually has: start a conversation, find an old
 * one, switch, rename, delete, sign out. No settings panel, no usage meter.
 *
 * Conversations are grouped by when they started, because "the one from
 * Tuesday" is how people remember them. Search appears only once there are
 * enough that scanning is slower than typing.
 */

const SEARCH_THRESHOLD = 6;
const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

function groupOf(iso) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

export function Sidebar({
  open,
  onClose,
  user,
  corpusLabel,
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onSignOut,
  pendingDelete,
  onUndo,
}) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const c of filtered) {
      const g = groupOf(c.created_at);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(c);
    }
    return GROUPS.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)]);
  }, [filtered]);

  function startRename(c) {
    setRenamingId(c.id);
    setRenameValue(c.title);
  }

  async function commitRename() {
    const id = renamingId;
    const value = renameValue.trim();
    setRenamingId(null);
    if (id && value) await onRename(id, value);
  }

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
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
            {query && (
              <button type="button" className="clear" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="convo-scroll" aria-label="Conversations">
        {filtered.length === 0 && (
          <p className="convo-empty">{query ? "Nothing matches." : "No conversations yet."}</p>
        )}

        {groups.map(([group, items]) => (
          <div className="convo-group" key={group}>
            <span className="label">
              {query ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : group}
            </span>

            {items.map((c) => {
              const renaming = renamingId === c.id;
              return (
                <div
                  key={c.id}
                  className={`convo-item ${c.id === activeId ? "active" : ""} ${renaming ? "renaming" : ""}`}
                >
                  {renaming ? (
                    <input
                      ref={renameRef}
                      className="rename"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={commitRename}
                      aria-label="Conversation title"
                      maxLength={120}
                    />
                  ) : (
                    <button
                      className="open"
                      onClick={() => {
                        onSelect(c.id);
                        onClose?.();
                      }}
                      onDoubleClick={() => startRename(c)}
                      title={`${c.title}\n${new Date(c.created_at).toLocaleString()}`}
                    >
                      {c.title}
                    </button>
                  )}

                  {!renaming && (
                    <Menu
                      label={`Options for ${c.title}`}
                      className="row-menu"
                      items={[
                        { label: "Rename", icon: <Pencil size={13} strokeWidth={2} />, onSelect: () => startRename(c) },
                        {
                          label: "Delete",
                          icon: <Trash2 size={13} strokeWidth={2} />,
                          destructive: true,
                          onSelect: () => onDelete(c.id),
                        },
                      ]}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {pendingDelete && (
        <div className="undo" role="status">
          <span>Conversation deleted</span>
          <button type="button" onClick={onUndo}>
            Undo
          </button>
        </div>
      )}

      <div className="sidebar-foot">
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="mode" title={user?.email}>
          {corpusLabel || user?.email}
        </span>
        <button className="btn-quiet" onClick={onSignOut} aria-label="Sign out">
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}
