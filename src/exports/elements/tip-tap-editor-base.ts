import { BaseElement } from "../../internal/elements/base-element.js";
import { Content, Editor, EditorOptions } from "@tiptap/core";
import { tipTapCoreStyles } from "../styles/tip-tap-core-styles.js";
// https://tiptap.dev/api/extensions/starter-kit#included-extensions
import StarterKit, { StarterKitOptions } from "@tiptap/starter-kit";
import {
  RhinoStarterKit,
  RhinoStarterKitOptions,
} from "../extensions/rhino-starter-kit.js";

import {
  CSSResult,
  html,
  PropertyDeclarations,
  PropertyValueMap,
  TemplateResult,
} from "lit";

import { AttachmentUpload } from "../attachment-upload.js";
import { AttachmentManager } from "../attachment-manager.js";

import { normalize } from "../styles/normalize.js";
import editorStyles from "../styles/editor.js";

import { AddAttachmentEvent } from "../events/add-attachment-event.js";

import type { Maybe } from "../../types.js";
import { AttachmentEditor } from "./attachment-editor.js";
import { FileAcceptEvent } from "../events/file-accept-event.js";
import { BeforeInitializeEvent } from "../events/before-initialize-event.js";
import { InitializeEvent } from "../events/initialize-event.js";
import { RhinoFocusEvent } from "../events/rhino-focus-event.js";
import { RhinoBlurEvent } from "../events/rhino-blur-event.js";
import { RhinoChangeEvent } from "../events/rhino-change-event.js";
import { SelectionChangeEvent } from "../events/selection-change-event.js";
import { RhinoPasteEvent } from "../events/rhino-paste-event.js";

export type Serializer = "" | "html" | "json";

export type RhinoEditorStarterKitOptions = StarterKitOptions &
  RhinoStarterKitOptions & {
    // Indentation is a special case because it uses built-in editor commands and doesn't rely on extensions.
    increaseIndentation: boolean;
    decreaseIndentation: boolean;
  };

export class TipTapEditorBase extends BaseElement {
  // Static

  /**
   * Default registration name
   */
  static baseName = "rhino-editor";

  static get styles(): CSSResult[] {
    return [normalize, tipTapCoreStyles, editorStyles];
  }

  static get properties(): PropertyDeclarations {
    return {
      readonly: { type: Boolean, reflect: true },
      editor: { state: true },
      editorElement: { state: true },
      input: {},
      class: { reflect: true },
      accept: { reflect: true },
    };
  }

  // Instance

  /**
   * Whether or not the editor should be editable.
   *
   * NOTE: a user can change this in the browser dev tools, don't rely on this to prevent
   * users from editing and attempting to save the document.
   */
  readonly: boolean = false;

  /**
   * The hidden input to attach to
   */
  input: Maybe<string>;

  /**
   * The currently attached TipTap instance
   */
  editor: Maybe<Editor>;

  /**
   * The element that TipTap is attached to
   */
  editorElement: Maybe<Element>;

  /**
   * JSON or HTML serializer used for determining the string to write to the hidden input.
   */
  serializer: Serializer = "html";

  /** Comma separated string passed to the attach-files input. */
  accept: string = "*";

  // Private instance

  private __starterKitOptions__: Partial<RhinoEditorStarterKitOptions> = {
    // We don't use the native strike since it requires configuring ActionText.
    strike: false,
  };

  get starterKitOptions(): Partial<RhinoEditorStarterKitOptions> {
    return this.__starterKitOptions__;
  }

  /**
   * Update this with new options and the TipTap instance and web component will automatically update.
   * with new values.
   */
  set starterKitOptions(options: Partial<RhinoEditorStarterKitOptions>) {
    this.__starterKitOptions__ = options;

    this.rebuildEditor();
  }

  /**
   * Reset mechanism. This is called on first connect, and called anytime extensions,
   * or editor options get modified to make sure we have a fresh instance.
   */
  rebuildEditor() {
    // Make sure we dont render the editor more than once.
    const cachedEditor = this.slottedEditor;

    // light-dom version.
    const div = document.createElement("div");
    div.setAttribute("slot", "editor");

    if (cachedEditor) {
      cachedEditor.replaceWith(div);
    } else {
      this.insertAdjacentElement("beforeend", div);
    }

    this.editor = this.__setupEditor(div);

    this.__bindEditorListeners();
    this.editorElement = div.querySelector(".ProseMirror");

    this.editorElement?.classList.add("trix-content");
    this.editorElement?.setAttribute("tabindex", "0");
    this.editorElement?.setAttribute("role", "textbox");

    // For good measure for rendering.
    this.requestUpdate();
  }

  protected willUpdate(
    changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    if (changedProperties.has("class")) {
      this.classList.add("rhino-editor");
    }
  }

  protected updated(
    changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    if (changedProperties.has("readonly")) {
      this.editor?.setEditable(!this.readonly);
    }
  }

  /** Used for registering things like <role-toolbar>, <role-tooltip>, <rhino-attachment-editor> */
  registerDependencies() {
    [AttachmentEditor].forEach((el) => el.define());
  }

  get slottedEditor() {
    return this.querySelector("[slot='editor']");
  }

  constructor() {
    super();

    this.registerDependencies();
    this.addEventListener(AddAttachmentEvent.eventName, this.handleAttachment);

    this.addEventListener("drop", this.handleDropFile);
    this.addEventListener("rhino-paste", this.handlePaste);
    this.addEventListener("rhino-file-accept", this.handleFileAccept);
  }

  connectedCallback(): void {
    super.connectedCallback();

    if (this.editor) {
      this.__unBindEditorListeners();
    }

    this.dispatchEvent(new BeforeInitializeEvent());

    this.classList.add("rhino-editor");

    setTimeout(() => {
      this.rebuildEditor();

      this.dispatchEvent(new InitializeEvent());
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.editor?.destroy();
  }

  /**
   * Used for determining how to handle uploads.
   *   Override this for substituting your own
   *   direct upload functionality.
   */
  handleAttachment = (event: AddAttachmentEvent) => {
    // To allow for event delegation to take effect, we wait until the next event loop to handle the attachment.
    setTimeout(() => {
      if (event.defaultPrevented) {
        return;
      }

      const { attachment, target } = event;

      if (target instanceof HTMLElement && attachment.file) {
        const upload = new AttachmentUpload(attachment, target);
        upload.start();
      }
    });
  };

  /** Override this to prevent specific file types from being uploaded. */
  handleFileAccept = (_event: FileAcceptEvent) => {};

  private __extensions__: EditorOptions["extensions"] = [];

  /**
   * This will be concatenated on top of the RhinoStarterKit and StarterKit extensions.
   */
  set extensions(extensions: EditorOptions["extensions"]) {
    this.__extensions__ = extensions;

    this.rebuildEditor();
  }

  get extensions(): EditorOptions["extensions"] {
    return this.__extensions__;
  }

  /**
   * Extend this to provide your own options, or override existing options.
   * The "element" is where the editor will be initialized.
   * This will be merged
   *   @example
   *    class ExtendedRhinoEditor extends TipTapEditor {
   *      editorOptions (_element: Element) {
   *        return {
   *          autofocus: true
   *        }
   *      }
   *    }
   *
   */
  editorOptions(_element?: Element): Partial<EditorOptions> {
    return {};
  }

  /**
   * Finds the <input> element in the light dom and updates it with the value of `#serialize()`
   */
  updateInputElementValue() {
    if (this.inputElement != null && this.editor != null && !this.readonly) {
      this.inputElement.value = this.serialize();
    }
  }

  /**
   * Function called when grabbing the content of the editor. Currently supports JSON or HTML.
   */
  serialize() {
    if (this.editor == null) return "";

    if (this.serializer?.toLowerCase() === "json")
      return JSON.stringify(this.editor.getJSON());

    return this.editor.getHTML();
  }

  /**
   * Searches for the <input> element in the light dom to write the HTML or JSON to.
   */
  get inputElement(): Maybe<HTMLInputElement> {
    if (this.input == null) return undefined;

    return document.getElementById(this.input) as Maybe<HTMLInputElement>;
  }

  async handleFiles(files: File[] | FileList): Promise<void> {
    if (this.editor == null) return;

    return new Promise((resolve, _reject) => {
      if (files == null) return;

      const fileAcceptEvents = [...files].map((file) => {
        const event = new FileAcceptEvent(file);
        this.dispatchEvent(event);
        return event;
      });

      const allowedFiles: File[] = [];

      for (let i = 0; i < fileAcceptEvents.length; i++) {
        const event = fileAcceptEvents[i];
        if (event.defaultPrevented) {
          continue;
        }
        allowedFiles.push(event.file);
      }

      const attachments = this.transformFilesToAttachments(allowedFiles);

      if (attachments == null || attachments.length <= 0) return;

      this.editor?.chain().focus().setAttachment(attachments).run();

      attachments.forEach((attachment) => {
        this.dispatchEvent(new AddAttachmentEvent(attachment));
      });

      // Need to reset the input otherwise you get this fun state where you can't
      //   insert the same file multiple times.
      resolve();
    });
  }

  handleDropFile = async (event: DragEvent) => {
    if (this.editor == null) return;
    if (event == null) return;
    if (!(event instanceof DragEvent)) return;

    const { dataTransfer } = event;
    if (dataTransfer == null) return;

    const hasFiles = dataTransfer.files?.length > 0;
    if (!hasFiles) return;

    event.preventDefault();

    await this.handleFiles(dataTransfer.files);
  };

  handlePaste = async (event: RhinoPasteEvent) => {
    if (this.editor == null) return;
    if (event == null) return;
    if (!(event instanceof ClipboardEvent)) return;

    const { clipboardData } = event;
    if (clipboardData == null) return;

    const hasFiles = clipboardData.files?.length > 0;
    if (!hasFiles) return;

    event.preventDefault();

    this.editor.commands.insertContent(clipboardData.items);
    await this.handleFiles(clipboardData.files);
  };

  transformFilesToAttachments(files?: File[] | FileList | null) {
    if (this.editor == null) return;
    if (files == null || files.length === 0) return;

    const attachments: AttachmentManager[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file == null) return;
      const src = URL.createObjectURL(file);

      const attachment: AttachmentManager = new AttachmentManager(
        {
          src,
          file,
        },
        this.editor.view,
      );

      attachments.push(attachment);
    }

    return attachments;
  }

  renderToolbar() {
    return html``;
  }

  renderDialog() {}

  render(): TemplateResult {
    return html`
      ${this.renderToolbar()}
      <div class="editor-wrapper" part="editor-wrapper">
        ${this.renderDialog()}
        <div class="editor" part="editor">
          <slot name="editor">
            <div class="trix-content"></div>
          </slot>
        </div>
      </div>
    `;
  }

  allOptions(element: Element) {
    return Object.assign(
      this.__defaultOptions(element),
      this.editorOptions(element),
    );
  }

  /**
   * Due to some inconsistencies in how Trix will render the inputElement based on if its
   * the HTML representation, or transfromed with `#to_trix_html` this gives
   * us a consistent DOM structure to parse for rich text comments.
   */
  private normalizeDOM(
    inputElement: Maybe<HTMLInputElement>,
    parser = new DOMParser(),
  ) {
    if (inputElement == null || inputElement.value == null) return;

    const doc = parser.parseFromString(inputElement.value, "text/html");
    const figures = [...doc.querySelectorAll("figure[data-trix-attachment]")];
    const filtersWithoutChildren = figures.filter(
      (figure) => figure.querySelector("figcaption") == null,
    );

    doc.querySelectorAll("div > figure:first-child").forEach((el) => {
      el.parentElement?.classList.add("attachment-gallery");
    });

    filtersWithoutChildren.forEach((figure) => {
      const attrs = figure.getAttribute("data-trix-attributes");

      if (!attrs) return;

      const { caption } = JSON.parse(attrs);
      if (caption) {
        figure.insertAdjacentHTML(
          "beforeend",
          `<figcaption class="attachment__caption">${caption}</figcaption>`,
        );
        return;
      }
    });

    doc.querySelectorAll("figure .attachment__name").forEach((el) => {
      if (el.textContent?.includes(" · ") === false) return;

      el.insertAdjacentText("beforeend", " · ");
    });

    const body = doc.querySelector("body");

    if (body) {
      inputElement.value = body.innerHTML;
    }
  }

  /**
   * @private
   * This is intentionally not to be configured by a user. It makes updating extensions hard.
   *  it also is a getter and not a variable so that it will rerun in case options change.
   */
  private get __starterKitExtensions__(): EditorOptions["extensions"] {
    return [
      StarterKit.configure(this.starterKitOptions),
      RhinoStarterKit.configure(this.starterKitOptions),
    ];
  }

  /**
   * @param {Element} element - The element that the editor will be installed onto.
   */
  private __defaultOptions(element: Element): Partial<EditorOptions> {
    let content: Content = this.inputElement?.value || "";

    if (content && this.serializer?.toLowerCase() === "json") {
      content = JSON.parse(content);
    }

    return {
      injectCSS: false,
      extensions: this.__starterKitExtensions__.concat(this.extensions),
      autofocus: false,
      element,
      content,
      editable: !this.readonly,
    };
  }

  private __handleCreate: EditorOptions["onCreate"] = () => {
    this.requestUpdate();
  };

  private __handleUpdate: EditorOptions["onUpdate"] = () => {
    this.updateInputElementValue();
    this.requestUpdate();
    this.dispatchEvent(new RhinoChangeEvent());
  };

  private __handleFocus: EditorOptions["onFocus"] = () => {
    this.dispatchEvent(new RhinoFocusEvent());
    this.requestUpdate();
  };

  private __handleBlur: EditorOptions["onBlur"] = () => {
    this.updateInputElementValue();
    this.requestUpdate();
    this.dispatchEvent(new RhinoBlurEvent());
  };

  private __handleSelectionUpdate: EditorOptions["onSelectionUpdate"] = ({
    transaction,
  }) => {
    this.requestUpdate();
    this.dispatchEvent(new SelectionChangeEvent({ transaction }));
  };

  private __handleTransaction: EditorOptions["onTransaction"] = () => {
    this.requestUpdate();
  };

  private __bindEditorListeners(): void {
    if (this.editor == null) return;

    this.editor.on("focus", this.__handleFocus);
    this.editor.on("create", this.__handleCreate);
    this.editor.on("update", this.__handleUpdate);
    this.editor.on("selectionUpdate", this.__handleSelectionUpdate);
    this.editor.on("transaction", this.__handleTransaction);
    this.editor.on("blur", this.__handleBlur);
  }

  private __unBindEditorListeners(): void {
    if (this.editor == null) return;

    this.editor.off("focus", this.__handleFocus);
    this.editor.off("create", this.__handleCreate);
    this.editor.off("update", this.__handleUpdate);
    this.editor.off("selectionUpdate", this.__handleSelectionUpdate);
    this.editor.off("transaction", this.__handleTransaction);
    this.editor.off("blur", this.__handleBlur);
  }

  private __setupEditor(element: Element): Editor {
    if (!this.serializer || this.serializer === "html") {
      // This is a super hacky way to get __to_trix_html to support figcaptions without patching it.
      this.normalizeDOM(this.inputElement);
    }

    const editor = new Editor(this.allOptions(element));

    return editor;
  }
}
