# Bellhouse

Bellhouse is a lightweight scheduler for running scripts, sending notifications, and starting agents on a machine you manage. It can run tasks at set times or in response to a message from another app. For example, it can run a script every morning or send a phone notification when a form is submitted.

## How it works

- A **bell** receives a webhook, a message sent by another app when something happens.
- A **schedule** starts a task at a set time.
- A **handler** does the work. It can send a push notification, run a script, or start an agent.

Bellhouse is designed for [Armillary](https://github.com/studiozojer/armillary) workspaces. You choose the events, schedules, and actions in a configuration called a binding. On macOS, a menu bar app lets you pause, resume, and check on your automations.

Tell your AI assistant what you want done and when. For example, “Set up Bellhouse to run my report script every weekday at 9 a.m.” Give it access to your workspace and point it to the [setup guide](OPERATIONS.md#run-locally) so it can set up the schedule for you to review. Once you enable it, Bellhouse takes care of each run while the service is running, even after you close the chat.

## Getting started

- [Run Bellhouse and configure your first binding](OPERATIONS.md#run-locally)
- [Install the macOS menu bar app](OPERATIONS.md#mac-menu-and-installation)
- [Connect Bellhouse to a Hearth virtual machine](environment/README.md)
