/**
 * Small block nodes StarterKit does not include: a checklist and a callout. The official task
 * list lives in @tiptap/extension-list, which the site does not depend on.
 */
import { mergeAttributes, Node } from "@tiptap/core";

export const TaskList = Node.create({
  name: "taskList",
  group: "block list",
  content: "taskItem+",
  parseHTML: () => [{ tag: 'ul[data-type="taskList"]', priority: 51 }],
  renderHTML: ({ HTMLAttributes }) => [
    "ul",
    mergeAttributes(HTMLAttributes, { "data-type": "taskList", class: "doc-tasks" }),
    0,
  ],
});

const CHECK_PATH = "M3.5 8.5l3 3 6-7";

export const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph",
  defining: true,

  addAttributes: () => ({
    checked: {
      default: false,
      keepOnSplit: false,
      parseHTML: (element) => element.getAttribute("data-checked") === "true",
      renderHTML: (attributes) => ({ "data-checked": String(attributes.checked) }),
    },
  }),

  parseHTML: () => [{ tag: 'li[data-type="taskItem"]', priority: 51 }],
  renderHTML: ({ HTMLAttributes }) => ["li", mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }), 0],

  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) };
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const item = document.createElement("li");
      item.dataset.type = "taskItem";
      item.className = "doc-task";
      const box = document.createElement("label");
      box.className = "doc-task-box";
      box.contentEditable = "false";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", "doc-task-check");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", CHECK_PATH);
      svg.append(path);
      box.append(checkbox, svg);
      const content = document.createElement("div");
      content.className = "doc-task-text";
      item.append(box, content);

      const sync = () => {
        const checked = node.attrs.checked === true;
        item.dataset.checked = String(checked);
        checkbox.checked = checked;
        checkbox.setAttribute("aria-label", checked ? "Done" : "Not done");
      };
      sync();

      // Toggle without focusing the editor, so a click never scrolls the page.
      checkbox.addEventListener("mousedown", (event) => event.preventDefault());
      checkbox.addEventListener("change", () => {
        const position = getPos();
        if (!editor.isEditable || position === undefined) {
          sync();
          return;
        }
        const { view } = editor;
        view.dispatch(view.state.tr.setNodeAttribute(position, "checked", checkbox.checked));
      });

      return {
        dom: item,
        contentDOM: content,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          node = updated;
          sync();
          return true;
        },
      };
    };
  },
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,

  addAttributes: () => ({
    emoji: {
      default: "💡",
      parseHTML: (element) => element.getAttribute("data-emoji") ?? "💡",
      renderHTML: (attributes) => ({ "data-emoji": attributes.emoji }),
    },
  }),

  parseHTML: () => [{ tag: 'aside[data-type="callout"]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "doc-callout" }),
    [
      "span",
      { class: "doc-callout-icon emoji", contenteditable: "false", "aria-hidden": "true" },
      node.attrs.emoji,
    ],
    ["div", { class: "doc-callout-body" }, 0],
  ],
});
