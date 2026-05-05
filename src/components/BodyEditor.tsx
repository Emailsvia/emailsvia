"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { forwardRef, useEffect, useImperativeHandle } from "react";

export type BodyEditorHandle = { insertAtCursor: (text: string) => void; focus: () => void };

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
};

const BodyEditor = forwardRef<BodyEditorHandle, Props>(function BodyEditor(
  { value, onChange, placeholder, minHeight = 380 },
  ref
) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Write your message…" }),
      // html: true preserves HTML blocks when pasting from Gmail / Docs / Word — bold,
      // italic, underline, lists, headings, links all survive the round-trip through markdown.
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true, linkify: true, breaks: true }),
    ],
    content: value,
    editorProps: {
      attributes: { class: "tiptap-area" },
    },
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown() as string;
      onChange(md);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        if (!editor) return;
        editor.chain().focus().insertContent(text).run();
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor]
  );

  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown() as string;
    if (!editor.isFocused && value !== current) {
      editor.commands.setContent(value, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return <div className="tiptap-editor" style={{ minHeight }} />;

  return (
    <div className="tiptap-editor" style={{ minHeight: minHeight + 40 }}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
});

export default BodyEditor;

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="tiptap-toolbar">
      <Btn title="Bold (⌘B)" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
        <Icon><path d="M6 4h8a4 4 0 014 4 3.8 3.8 0 01-2 3.3A4 4 0 0117 15a5 5 0 01-5 5H6V4z M6 12h7M6 4v16" /></Icon>
      </Btn>
      <Btn title="Italic (⌘I)" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
        <Icon><path d="M19 4h-9M14 20H5M15 4L9 20" /></Icon>
      </Btn>
      <Btn title="Underline (⌘U)" onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}>
        <Icon><path d="M6 3v7a6 6 0 0012 0V3M4 21h16" /></Icon>
      </Btn>
      <Btn title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
        <Icon><path d="M16 4H9a3 3 0 00-2.83 4M14 12a4 4 0 01.8 7.6 6 6 0 01-8.8-2.6M4 12h16" /></Icon>
      </Btn>

      <Divider />

      <Btn title="Heading" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
        <Icon><path d="M4 12h8M4 18V6M12 18V6M21 18V8l-2 2" /></Icon>
      </Btn>
      <Btn title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
        <Icon><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Icon>
      </Btn>
      <Btn title="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
        <Icon><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></Icon>
      </Btn>
      <Btn title="Blockquote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
        <Icon><path d="M3 21c3 0 7-1 7-8V5H4v6h3c0 1-.3 3-4 3zM14 21c3 0 7-1 7-8V5h-6v6h3c0 1-.3 3-4 3z" /></Icon>
      </Btn>

      <Divider />

      <Btn
        title="Link"
        onClick={() => {
          const existing = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("URL", existing ?? "https://");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
        active={editor.isActive("link")}
      >
        <Icon><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></Icon>
      </Btn>
      <Btn title="Clear formatting" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
        <Icon><path d="M4 7V4h16v3M5 20h6M13 4L8 20" /></Icon>
      </Btn>

      <div className="ml-auto flex items-center gap-2 pr-2 text-[10px] uppercase tracking-[0.12em] text-ink-400 font-medium">
        Markdown
      </div>
    </div>
  );
}

function Btn({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
        active ? "bg-ink text-paper" : "text-ink-600 hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-ink-200 mx-1" />;
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
