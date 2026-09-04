import { useEffect, useMemo, useRef, useState } from "react";
import {
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  Pencil,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { Wordmark } from "./brand";
import { Menu } from "./menu";

/**
 * Conversation navigation.
 *
 * One sidebar in two widths. Expanded: wordmark, new conversation, the
 * grouped list, account. Collapsed: the same things as a rail of icons,
 * where the mark, the conversations icon and the avatar all expand it
 * again. Nothing is exclusive to one state.
 *
 * The rows are dense on purpose -- 30px, no card, one line -- because a
 * student will have dozens of these by mid-course and the list has to
 * hold them without scrolling every few items.
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
  collapsed,
  onToggle,
  open,
  onClose,
  user,
  corpusLabel,
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onSignOut,
  pendingDelete,
  onUndo,
  renamingId,
  onStartRename,
  onCommitRename,
  onCancelRename,
}) {
  const [query, setQuery] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef(null);

  useEffect(() => {
    if (!renamingId) return;
    const current = conversations.find((c) => c.id === renamingId);
    setRenameValue(current?.title ?? "");
    // Focus after the input has rendered.
    const t = setTimeout(() => renameRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [renamingId, conversations]);

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

  const initials = (user?.email || "?").slice(0, 2).toUpperCase();

  if (collapsed) {
    return (
      <aside className="sidebar collapsed" aria-label="Navigation, collapsed">
        <div className="sidebar-head">
          <button className="rail-btn brand-btn" onClick={onToggle} aria-label="Expand sidebar" title="Expand sidebar">
            <Wordmark compact />
          </button>
        </div>
        <div className="sidebar-actions">
          <button className="rail-btn" onClick={onCreate} aria-label="New conversation" title="New conversation">
            <SquarePen size={17} strokeWidth={2} />
          </button>
          <button className="rail-btn" onClick={onToggle} aria-label="Show conversations" title="Conversations">
            <MessagesSquare size={17} strokeWidth={2} />
          </button>
        </div>
        <div className="rail-spacer" />
        <div className="sidebar-foot">
          <button className="rail-btn avatar" onClick={onToggle} aria-label="Account" title={user?.email}>
            {initials}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-head">
        <Wordmark />
        <button className="icon-btn collapse" onClick={onToggle} aria-label="Collapse sidebar" title="Collapse sidebar">
          <PanelLeftClose size={16} strokeWidth={2} />
        </button>
        <button className="icon-btn close-drawer" onClick={onClose} aria-label="Close navigation">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="new-chat" onClick={onCreate}>
          <SquarePen size={16} strokeWidth={2} />
          <span>New conversation</span>
        </button>

        {conversations.length >= SEARCH_THRESHOLD && (
          <div className="search">
            <Search size={14} strokeWidth={2} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search"
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
            <span className="group-label">
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
                          onCommitRename(c.id, renameValue);
                        }
                        if (e.key === "Escape") onCancelRename();
                      }}
                      onBlur={() => onCommitRename(c.id, renameValue)}
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
                      onDoubleClick={() => onStartRename(c.id)}
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
                        { label: "Rename", icon: <Pencil size={13} strokeWidth={2} />, onSelect: () => onStartRename(c.id) },
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
        <button className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
          <LogOut size={15} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}
