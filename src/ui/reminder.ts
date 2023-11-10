import type { ReadOnlyReference } from "model/ref";
import type { DateTime } from "model/time";
import { App, Modal } from "obsidian";
import { SETTINGS } from "settings";
import type { Reminder } from "../model/reminder";
import type { Later } from "../model/time";
import ReminderView from "./components/Reminder.svelte";
const electron = require("electron");

export class ReminderModal {

  constructor(private app: App, private usePhonePushNotifications: ReadOnlyReference<boolean>, private ntfyTopic: ReadOnlyReference<string>, private useSystemNotification: ReadOnlyReference<boolean>, private laters: ReadOnlyReference<Array<Later>>) { }

  public show(
    reminder: Reminder,
    onRemindMeLater: (time: DateTime) => void,
    onDone: () => void,
    onMute: () => void,
    onOpenFile: () => void
  ) {
    if (!this.isSystemNotification()) {
      this.showBuiltinReminder(reminder, onRemindMeLater, onDone, onMute, onOpenFile);
    } else {
      // Show system notification
      const Notification = (electron as any).remote.Notification;
      const n = new Notification({
        title: "Obsidian Reminder",
        body: reminder.title,
      });

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "https://ntfy.sh/", true);
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status === 200) {
            console.log("Notification sent successfully");
          } else {
            console.error("Failed to send notification", xhr.statusText);
          }
        }
      };

      let data = JSON.stringify({
        "topic": this.ntfyTopic,
        "title": reminder.title,
        "message": "Reminder: " + reminder.title,
        "click": `obsidian://open?vault=${this.app.vault}&file=${encodeURIComponent(reminder.file)}`
      });

      xhr.send(data);


      n.on("click", () => {
        n.close();
        this.showBuiltinReminder(reminder, onRemindMeLater, onDone, onMute, onOpenFile);
      });
      n.on("close", () => {
        onMute();
      });
      // Only for macOS
      {
        const laters = SETTINGS.laters.value;
        n.on("action", (_: any, index: any) => {
          if (index === 0) {
            onDone();
            return;
          }
          const later = laters[index - 1]!;
          onRemindMeLater(later.later());
        });
        const actions = [{ type: "button", text: "Mark as Done" }];
        laters.forEach(later => {
          actions.push({ type: "button", text: later.label })
        });
        n.actions = actions as any;
      }

      n.show();
    }
  }

  private showBuiltinReminder(
    reminder: Reminder,
    onRemindMeLater: (time: DateTime) => void,
    onDone: () => void,
    onCancel: () => void,
    onOpenFile: () => void
  ) {
    new NotificationModal(this.app, this.laters.value, reminder, onRemindMeLater, onDone, onCancel, onOpenFile).open();
  }

  private isSystemNotification() {
    if (this.isMobile() && !this.usePhonePushNotifications) {
      return false;
    }
    return this.useSystemNotification.value;
  }

  private isMobile() {
    return electron === undefined;
  }


}

class NotificationModal extends Modal {

  canceled: boolean = true;

  constructor(
    app: App,
    private laters: Array<Later>,
    private reminder: Reminder,
    private onRemindMeLater: (time: DateTime) => void,
    private onDone: () => void,
    private onCancel: () => void,
    private onOpenFile: () => void
  ) {
    super(app);
  }

  override onOpen() {
    // When the modal is opened we mark the reminder as being displayed. This
    // lets us introspect the reminder's display state from elsewhere.
    this.reminder.beingDisplayed = true;

    let { contentEl } = this;
    new ReminderView({
      target: contentEl,
      props: {
        reminder: this.reminder,
        laters: this.laters,
        component: this,
        onRemindMeLater: (time: DateTime) => {
          this.onRemindMeLater(time);
          this.canceled = false;
          this.close();
        },
        onDone: () => {
          this.canceled = false;
          this.onDone();
          this.close();
        },
        onOpenFile: () => {
          this.canceled = true;
          this.onOpenFile();
          this.close();
        },
        onMute: () => {
          this.canceled = true;
          this.close();
        },
      },
    });
  }

  override onClose() {
    // Unset the reminder from being displayed. This lets other parts of the
    // plugin continue.
    this.reminder.beingDisplayed = false;
    let { contentEl } = this;
    contentEl.empty();
    if (this.canceled) {
      this.onCancel();
    }
  }
}
