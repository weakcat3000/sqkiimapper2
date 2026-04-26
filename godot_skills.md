# Godot MCP Skills & Capabilities

This document outlines the core skills and capabilities provided by the Godot Model Context Protocol (MCP) Server, as well as auxiliary testing and deployment strategies. When responding to user requests related to Godot 4.x game development, you must utilize these tools intelligently to manipulate the game engine and its assets.

## 1. Project Management & Intelligence
**When to use:** When you need context about the environment, the version, or the overall structure of the game project.

*   `mcp_godot_get_godot_version`: Verify the installed Godot engine version before writing Godot 4.x specific syntax (like `@export` vs `export`).
*   `mcp_godot_list_projects`: Use this to find the root directory of a Godot project (where `project.godot` lives) so you can set your `projectPath` for other tools.
*   `mcp_godot_get_project_info`: Fetch core configuration details, display settings, and input mappings straight from the project metadata.
*   `mcp_godot_get_uid` & `mcp_godot_update_project_uids`: Manage internal Unique Identifiers (UIDs) for Godot 4.4+ to ensure resource references haven't broken.

## 2. Editor & Playtesting
**When to use:** When the user wants to see their changes visually, test the game, or retrieve crash logs.

*   `mcp_godot_launch_editor`: Open the visual Godot Editor UI for the user so they can inspect scenes manually.
*   `mcp_godot_run_project`: Automatically launch the game or a specific test scene (e.g., `res://scenes/level_1.tscn`). 
*   `mcp_godot_get_debug_output`: **Crucial Skill.** Always run this after running the project to check for `Error:` or `Warning:` messages in the Godot console. If the application crashes, use this to read the stack trace.
*   `mcp_godot_stop_project`: Teardown step. Always ensure you stop running processes once testing or log retrieval is done.

## 3. Procedural Scene Generation
**When to use:** When you need to construct or modify Godot `.tscn` files without manually editing the text file (which is error-prone).

*   `mcp_godot_create_scene`: Bootstrap a new scene with a specified root node (e.g. `Node2D`, `Control`, `CharacterBody3D`).
*   `mcp_godot_add_node`: Procedurally attach child nodes to an existing scene tree (e.g. adding a `CollisionShape2D` to a `RigidBody2D`). Provide custom properties as a JSON object during creation.
*   `mcp_godot_load_sprite`: Quickly bind an image asset to a `Sprite2D` node.
*   `mcp_godot_save_scene`: Persist changes made to the scene tree via the MCP, or fork the scene by saving it to a `newPath`.
*   `mcp_godot_export_mesh_library`: Convert a Godot scene containing 3D meshes into a compiled `.res` MeshLibrary for use in GridMaps.

## 4. Testing & Automation (Terminal)
**When to use:** When the user requests unit tests, integration tests, or UI automation for the Godot game. You can execute these via your standard terminal action capabilities (`run_command`).

*   **GdUnit4 Testing**: If building standard tests in GDScript, execute them headlessly from the terminal using the GdUnit4 command-line tool.
    *   Command: `godot --headless --path <project_dir> -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd --run-tests`
*   **PlayGodot Automation**: When end-to-end (E2E) testing is requested, use Python with pytest. PlayGodot acts like Playwright for Godot, allowing you to manipulate node states and simulate input externally.
    *   Initialize it via: `pip install playgodot pytest pytest-asyncio`
    *   Execute via: `pytest tests/ -v`

## 5. Deployment & Export
**When to use:** When asked to package the game for web, desktop, or mobile, or deploying the final build to a host.

*   **Headless Web Exports**: Use your terminal tools to automatically build a WebAssembly version of the Godot project.
    *   Command: `godot --headless --export-release "Web" ./build/index.html`
*   **Vercel Deployment**: To instantly host the web export, you can link and deploy using the Vercel CLI from the terminal.
    *   Command: `vercel deploy ./build --prod`

## General Guidelines
1. **Path Formatting**: Always ensure the `projectPath` is absolute, but Godot-internal paths should use the `res://` prefix or be relative to the `project.godot` directory as specified by the individual tool.
2. **Scripting**: For editing GDScript (`.gd`) files, rely on your standard file-system editing capabilities rather than the Godot MCP, which is currently optimized for nodes, engine execution, and structural scene changes.
