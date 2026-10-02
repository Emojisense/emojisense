import { CHANNELS, PEOPLE, type PersonId } from "./content";
import { ChevronIcon, HashIcon, SearchIcon, ThreadIcon } from "./icons";
import { Avatar } from "./MessageItem";

const DIRECT: PersonId[] = ["priya", "marcus", "lena"];

/** Decorative workspace navigation: only #launch exists in this demo, so it is hidden from assistive tech. */
export function Sidebar() {
  return (
    <aside className="chat-side" aria-hidden="true">
      <div className="chat-ws">
        <span className="chat-ws-mark">F</span>
        <span className="chat-ws-name">Fernhill</span>
        <ChevronIcon />
      </div>

      <div className="chat-side-search">
        <SearchIcon />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </div>

      <div className="chat-side-item">
        <ThreadIcon />
        <span>Threads</span>
      </div>

      <p className="chat-side-label">Channels</p>
      <ul className="chat-side-list">
        {CHANNELS.map((channel) => {
          const active = "active" in channel;
          const unread = "unread" in channel ? channel.unread : 0;
          return (
            <li
              key={channel.name}
              className={`chat-side-item${active ? " is-active" : ""}${unread ? " is-unread" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <HashIcon />
              <span>{channel.name}</span>
              {unread > 0 && <span className="chat-side-badge">{unread}</span>}
            </li>
          );
        })}
      </ul>

      <p className="chat-side-label">Direct messages</p>
      <ul className="chat-side-list">
        {DIRECT.map((id) => {
          const person = PEOPLE[id];
          return (
            <li key={id} className="chat-side-item is-person">
              <span className="chat-side-avatar">
                <Avatar initials={person.initials} tone={person.tone} small />
                <span className={`chat-presence is-${person.presence ?? "away"}`} />
              </span>
              <span>{person.name}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
