extends Node2D
## Battle Board — Manages the 8x5 grid, unit placement, and battle simulation.

signal battle_ended(player_won: bool, units_remaining: int)

const GRID_COLS: int = 8
const GRID_ROWS: int = 5
const CELL_SIZE: int = 80
const GRID_OFFSET := Vector2(320, 90)  # Top-left corner of grid on screen

# Grid state: grid_pos (Vector2i) -> unit node reference
var _grid: Dictionary = {}
var _player_units: Array = []
var _enemy_units: Array = []
var _battle_active: bool = false
var _battle_timer: float = 0.0
const TICK_INTERVAL: float = 0.1

# Blocked tiles (from skills like Ice Wall)
var _blocked_tiles: Dictionary = {}  # grid_pos -> Timer


func _ready() -> void:
	queue_redraw()


func _draw() -> void:
	# Draw grid cells
	for col in GRID_COLS:
		for row in GRID_ROWS:
			var _rect := Rect2(
				GRID_OFFSET + Vector2(col * CELL_SIZE, row * CELL_SIZE),
				Vector2(CELL_SIZE, CELL_SIZE)
			)
			# Player half (bottom rows 3-4) vs enemy half (top rows 0-1), middle row 2
			var cell_color: Color
			if row <= 1:
				cell_color = Color(0.6, 0.2, 0.2, 0.15)  # Enemy zone - red tint
			elif row >= 3:
				cell_color = Color(0.2, 0.4, 0.6, 0.15)  # Player zone - blue tint
			else:
				cell_color = Color(0.3, 0.3, 0.3, 0.1)  # Neutral middle
			draw_rect(_rect, cell_color, true)
			draw_rect(_rect, Color(0.4, 0.4, 0.4, 0.3), false, 1.0)

	# Highlight blocked tiles
	for pos in _blocked_tiles:
		var rect := Rect2(
			GRID_OFFSET + Vector2(pos.x * CELL_SIZE, pos.y * CELL_SIZE),
			Vector2(CELL_SIZE, CELL_SIZE)
		)
		draw_rect(rect, Color(0.3, 0.7, 0.9, 0.4), true)


func _process(delta: float) -> void:
	if not _battle_active:
		return

	_battle_timer += delta
	if _battle_timer >= TICK_INTERVAL:
		_battle_timer -= TICK_INTERVAL
		_battle_tick()


## Convert grid position to world position (center of cell)
func grid_to_world(grid_pos: Vector2i) -> Vector2:
	return GRID_OFFSET + Vector2(grid_pos.x * CELL_SIZE + CELL_SIZE / 2.0, grid_pos.y * CELL_SIZE + CELL_SIZE / 2.0)


## Convert world position to grid position
func world_to_grid(world_pos: Vector2) -> Vector2i:
	var local: Vector2 = world_pos - GRID_OFFSET
	return Vector2i(int(local.x / CELL_SIZE), int(local.y / CELL_SIZE))


## Check if a grid position is valid
func is_valid_cell(pos: Vector2i) -> bool:
	return pos.x >= 0 and pos.x < GRID_COLS and pos.y >= 0 and pos.y < GRID_ROWS


## Check if a cell is occupied
func is_cell_occupied(pos: Vector2i) -> bool:
	return _grid.has(pos) or _blocked_tiles.has(pos)


## Get the unit at a grid position, if any
func get_unit_at(pos: Vector2i) -> Node2D:
	if _grid.has(pos):
		return _grid[pos]
	return null


## Place a unit on the grid
func place_unit(unit_node: Node2D, grid_pos: Vector2i) -> bool:
	if not is_valid_cell(grid_pos) or is_cell_occupied(grid_pos):
		return false
	_grid[grid_pos] = unit_node
	unit_node.position = grid_to_world(grid_pos)
	unit_node.set_meta("grid_pos", grid_pos)
	return true


## Remove a unit from the grid
func remove_unit(grid_pos: Vector2i) -> Node2D:
	if _grid.has(grid_pos):
		var unit = _grid[grid_pos]
		_grid.erase(grid_pos)
		return unit
	return null


## Move a unit from one cell to another
func move_unit(from: Vector2i, to: Vector2i) -> bool:
	if not _grid.has(from) or is_cell_occupied(to) or not is_valid_cell(to):
		return false
	var unit = _grid[from]
	_grid.erase(from)
	_grid[to] = unit
	unit.set_meta("grid_pos", to)
	# Animate movement
	var tween := create_tween()
	tween.tween_property(unit, "position", grid_to_world(to), 0.15)
	return true


## Start the battle phase
func start_battle(player_units: Array, enemy_units: Array) -> void:
	_player_units = player_units
	_enemy_units = enemy_units
	_battle_active = true
	_battle_timer = 0.0


## Stop the battle
func stop_battle() -> void:
	_battle_active = false


## One battle tick — process all units
func _battle_tick() -> void:
	# Clean up dead units
	_player_units = _player_units.filter(func(u): return u != null and is_instance_valid(u) and u.get_meta("current_hp", 0) > 0)
	_enemy_units = _enemy_units.filter(func(u): return u != null and is_instance_valid(u) and u.get_meta("current_hp", 0) > 0)

	# Check win/loss
	if _enemy_units.is_empty():
		_battle_active = false
		battle_ended.emit(true, _player_units.size())
		return
	if _player_units.is_empty():
		_battle_active = false
		battle_ended.emit(false, _enemy_units.size())
		return

	# Process each unit
	var all_units: Array = []
	all_units.append_array(_player_units)
	all_units.append_array(_enemy_units)

	# Sort by attack speed (fastest first)
	all_units.sort_custom(func(a, b):
		return a.get_meta("attack_speed", 1.0) > b.get_meta("attack_speed", 1.0)
	)

	for unit in all_units:
		if unit == null or not is_instance_valid(unit):
			continue
		if unit.get_meta("current_hp", 0) <= 0:
			continue
		if unit.get_meta("stunned", false):
			continue

		_process_unit(unit)

	queue_redraw()


func _process_unit(unit: Node2D) -> void:
	var is_player: bool = unit.get_meta("is_player", true)
	var enemies: Array = _enemy_units if is_player else _player_units
	var _allies: Array = _player_units if is_player else _enemy_units
	var unit_pos: Vector2i = unit.get_meta("grid_pos", Vector2i.ZERO)
	var unit_range: int = unit.get_meta("range", 1)

	# Check attack cooldown
	var cooldown: float = unit.get_meta("attack_cooldown", 0.0)
	if cooldown > 0:
		unit.set_meta("attack_cooldown", cooldown - TICK_INTERVAL)
		return

	# Build enemy info array for targeting
	var enemy_info: Array = []
	for e in enemies:
		if e == null or not is_instance_valid(e) or e.get_meta("current_hp", 0) <= 0:
			continue
		enemy_info.append({
			"instance_id": e.get_instance_id(),
			"node": e,
			"grid_pos": e.get_meta("grid_pos", Vector2i.ZERO),
			"role": e.get_meta("role", ""),
			"current_hp": e.get_meta("current_hp", 0)
		})

	if enemy_info.is_empty():
		return

	# Find target
	var unit_data := {
		"role": unit.get_meta("role", ""),
		"attack_type": unit.get_meta("attack_type", ""),
		"element": unit.get_meta("element", ""),
		"attack": unit.get_meta("attack", 0)
	}
	var target_info := AITargeting.find_target(unit_data, unit_pos, enemy_info)
	if target_info.is_empty():
		return

	var target_pos: Vector2i = target_info.get("grid_pos", Vector2i.ZERO)
	var distance := AITargeting.manhattan_distance(unit_pos, target_pos)

	# If in range, attack
	if distance <= unit_range:
		_do_attack(unit, target_info.get("node"))
	else:
		# Move toward target
		var next_pos := _find_next_step(unit_pos, target_pos)
		if next_pos != unit_pos:
			move_unit(unit_pos, next_pos)


func _do_attack(attacker: Node2D, defender: Node2D) -> void:
	if defender == null or not is_instance_valid(defender):
		return

	var attacker_data := {
		"attack": attacker.get_meta("attack", 0),
		"attack_type": attacker.get_meta("attack_type", ""),
		"element": attacker.get_meta("element", "")
	}
	var defender_data := {
		"armor_type": defender.get_meta("armor_type", ""),
		"element": defender.get_meta("element", "")
	}

	var damage := CombatManager.calculate_damage(attacker_data, defender_data)

	# Apply damage
	var def_hp: float = defender.get_meta("current_hp", 0)
	var shield: float = defender.get_meta("shield", 0.0)
	if shield > 0:
		var absorbed := minf(shield, damage)
		shield -= absorbed
		damage -= absorbed
		defender.set_meta("shield", shield)
	def_hp -= damage
	defender.set_meta("current_hp", maxf(def_hp, 0))

	# Update HP bar on defender
	if defender.has_method("update_hp_bar"):
		defender.call("update_hp_bar")

	# Attack animation — lunge for melee, projectile for ranged
	var atk_range: int = attacker.get_meta("range", 1)
	if atk_range <= 1:
		if attacker.has_method("attack_lunge"):
			attacker.call("attack_lunge", defender.position)
		AudioManager.play_sfx("melee")
	else:
		var atk_element: String = attacker.get_meta("element", "fire")
		if attacker.has_method("ranged_attack"):
			attacker.call("ranged_attack", defender.position, atk_element)
		AudioManager.play_sfx("ranged")

	# Flash defender red
	if defender.has_method("flash_hit"):
		defender.call("flash_hit")
	AudioManager.play_sfx("hit")

	# Attacker gains mana
	var atk_mana: float = attacker.get_meta("current_mana", 0)
	atk_mana += CombatManager.get_mana_on_attack()
	attacker.set_meta("current_mana", atk_mana)

	# Defender gains mana on hit
	var def_mana: float = defender.get_meta("current_mana", 0)
	def_mana += CombatManager.get_mana_on_hit()
	defender.set_meta("current_mana", def_mana)

	# Check if mana full -> cast skill
	var atk_mana_max: float = attacker.get_meta("mana_max", 100)
	if atk_mana >= atk_mana_max:
		_cast_skill(attacker)

	# Set attack cooldown
	var atk_speed: float = attacker.get_meta("attack_speed", 1.0)
	attacker.set_meta("attack_cooldown", 1.0 / atk_speed)

	# Check if defender died
	if def_hp <= 0:
		_unit_defeated(defender)


func _cast_skill(caster: Node2D) -> void:
	caster.set_meta("current_mana", 0.0)
	var is_player: bool = caster.get_meta("is_player", true)
	var allies := _player_units if is_player else _enemy_units
	var enemies := _enemy_units if is_player else _player_units
	var caster_pos: Vector2i = caster.get_meta("grid_pos", Vector2i.ZERO)

	# Build caster data
	var caster_data: Dictionary = {}
	for key in ["skill_type", "skill_params", "instance_id", "role"]:
		caster_data[key] = caster.get_meta(key, "")
	caster_data["instance_id"] = str(caster.get_instance_id())

	# Build ally/enemy info
	var ally_info: Array = []
	for a in allies:
		if a != null and is_instance_valid(a) and a.get_meta("current_hp", 0) > 0:
			ally_info.append({
				"instance_id": str(a.get_instance_id()),
				"node": a,
				"grid_pos": a.get_meta("grid_pos", Vector2i.ZERO),
				"current_hp": a.get_meta("current_hp", 0)
			})

	var enemy_info: Array = []
	for e in enemies:
		if e != null and is_instance_valid(e) and e.get_meta("current_hp", 0) > 0:
			enemy_info.append({
				"instance_id": str(e.get_instance_id()),
				"node": e,
				"grid_pos": e.get_meta("grid_pos", Vector2i.ZERO),
				"current_hp": e.get_meta("current_hp", 0),
				"role": e.get_meta("role", "")
			})

	var effects := SkillSystem.execute_skill(caster_data, caster_pos, ally_info, enemy_info)

	# Apply effects
	for effect in effects:
		_apply_effect(effect, allies, enemies)

	# Visual: flash caster blue for skill cast
	if caster.has_method("flash_cast"):
		caster.call("flash_cast")
	AudioManager.play_sfx("skill")
	
	var main_ref = get_parent()
	if main_ref and main_ref.has_method("juice_camera_punch"):
		main_ref.call("juice_camera_punch", 1.2)
	
	# Spawn Floating Combat Text for skill name
	var skill_name: String = caster.get_meta("skill_name", "Skill!")
	var lbl := Label.new()
	lbl.text = skill_name
	lbl.position = caster.position + Vector2(-50, -40)
	lbl.set("theme_override_colors/font_color", Color(1.0, 0.8, 0.2)) # Gold
	lbl.set("theme_override_colors/font_outline_color", Color(0, 0, 0))
	lbl.set("theme_override_constants/outline_size", 4)
	lbl.set("theme_override_font_sizes/font_size", 14)
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.custom_minimum_size = Vector2(100, 20)
	add_child(lbl)
	
	var txt_tween := create_tween()
	txt_tween.tween_property(lbl, "position:y", lbl.position.y - 30.0, 1.0).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	txt_tween.parallel().tween_property(lbl, "modulate:a", 0.0, 1.0).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_EXPO)
	txt_tween.tween_callback(lbl.queue_free)


func _apply_effect(effect: Dictionary, allies: Array, enemies: Array) -> void:
	var target_id: String = str(effect.get("target_id", ""))
	var all_units: Array = []
	all_units.append_array(allies)
	all_units.append_array(enemies)

	var target: Node2D = null
	for u in all_units:
		if u != null and is_instance_valid(u) and str(u.get_instance_id()) == target_id:
			target = u
			break

	match effect.get("type", ""):
		"damage":
			if target != null:
				var hp: float = target.get_meta("current_hp", 0)
				hp -= effect.get("value", 0)
				target.set_meta("current_hp", maxf(hp, 0))
				if target.has_method("update_hp_bar"):
					target.call("update_hp_bar")
				if target.has_method("flash_hit"):
					target.call("flash_hit")
				if hp <= 0:
					_unit_defeated(target)
		"heal":
			if target != null:
				var hp: float = target.get_meta("current_hp", 0)
				var max_hp: float = target.get_meta("max_hp", hp)
				hp = minf(hp + effect.get("value", 0), max_hp)
				target.set_meta("current_hp", hp)
				if target.has_method("update_hp_bar"):
					target.call("update_hp_bar")
		"shield":
			if target != null:
				target.set_meta("shield", effect.get("value", 0))
		"stun":
			if target != null:
				target.set_meta("stunned", true)
				# Remove stun after duration
				get_tree().create_timer(effect.get("duration", 1.0)).timeout.connect(func():
					if target != null and is_instance_valid(target):
						target.set_meta("stunned", false)
				)
		"slow":
			if target != null:
				var orig_speed: float = target.get_meta("attack_speed", 1.0)
				var slow_pct: float = effect.get("value", 0.3)
				target.set_meta("attack_speed", orig_speed * (1.0 - slow_pct))
				get_tree().create_timer(effect.get("duration", 2.0)).timeout.connect(func():
					if target != null and is_instance_valid(target):
						target.set_meta("attack_speed", orig_speed)
				)


func _unit_defeated(unit: Node2D) -> void:
	var pos: Vector2i = unit.get_meta("grid_pos", Vector2i.ZERO)
	_grid.erase(pos)
	_player_units.erase(unit)
	_enemy_units.erase(unit)

	# Fade out and remove
	AudioManager.play_sfx("death")
	var tween := create_tween()
	tween.tween_property(unit, "modulate:a", 0.0, 0.3)
	tween.tween_callback(unit.queue_free)


## Simple BFS one-step pathfinding toward target
func _find_next_step(from: Vector2i, to: Vector2i) -> Vector2i:
	var best_pos := from
	var best_dist: int = AITargeting.manhattan_distance(from, to)

	# Try all 4 directions
	for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		var next: Vector2i = from + dir
		if is_valid_cell(next) and not is_cell_occupied(next):
			var dist: int = AITargeting.manhattan_distance(next, to)
			if dist < best_dist:
				best_dist = dist
				best_pos = next

	return best_pos


## Spawn enemy units for a round (AI opponent)
func spawn_enemy_round(round_num: int) -> void:
	# Number of enemies scales with round
	var enemy_count: int = mini(2 + int(round_num / 2.0), 5)
	var all_ids := UnitData.get_all_ids()

	for i in enemy_count:
		var unit_id: String = all_ids[randi() % all_ids.size()]
		var unit_data := UnitData.get_unit(unit_id)

		# Create unit node
		var unit_scene := preload("res://scenes/unit.tscn")
		var unit_node: Node2D = unit_scene.instantiate()
		add_child(unit_node)

		# Set up unit with data
		unit_node.call("setup_from_data", unit_data, false)

		# Place in enemy zone (rows 0-1)
		var placed := false
		for _attempt in 20:
			var col := randi() % GRID_COLS
			var row := randi() % 2  # enemy rows 0-1
			var pos := Vector2i(col, row)
			if place_unit(unit_node, pos):
				_enemy_units.append(unit_node)
				placed = true
				break

		if not placed:
			unit_node.queue_free()


## Clear the board between rounds
func clear_board() -> void:
	for pos in _grid.keys():
		var unit = _grid[pos]
		if unit != null and is_instance_valid(unit):
			unit.queue_free()
	_grid.clear()
	_player_units.clear()
	_enemy_units.clear()
	_blocked_tiles.clear()
	queue_redraw()
