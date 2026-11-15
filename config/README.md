# raccfo config folder

This folder is mounted at `/config` in the container. Everything here is optional.

- `apps.json`: copy `site/apps.json` here and edit it to add, remove or reword apps. raccfo reads it on every page load, so no restart is needed.
- `icons/` and `screenshots/`: files here are served at `/icons/...` and `/screenshots/...` and win over the built-in ones, so you can add a screenshot by dropping it in `screenshots/<app>/` and listing it in `apps.json`.
