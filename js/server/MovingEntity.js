/**
 * Created by Jerome on 24-02-17.
 */

const GameServer = require('./GameServer.js').GameServer;
const randomInt = require('./GameServer.js').randomInt;
const GameObject = require('./GameObject.js').GameObject;
const Route = require('./Route.js').Route;

// Parent class of players and monsters
class MovingEntity extends GameObject {
  constructor() {
    super();
    this.inFight = false;
    this.targetID = null;
    this.alive = true;
    this.foes = [];
    this.lastFightUpdate = Date.now();
    this.lastDamage = Date.now();
    this.lastWalkUpdate = Date.now();
  }


  setRoute(path, departureTime, latency, action, orientation) {
    this.route = new Route(this, path, departureTime, latency, action, orientation);
    this.updateAOIRoutes();
  }

  updateAOIRoutes() {
    const AOIs = this.listAdjacentAOIs(true);
    const category = this.category;
    const id = this.id;
    const route = this.route;
    AOIs.forEach((aoi) => {
      GameServer.updateAOIroute(aoi, category, id, route.trim(category));
    });
  }

  setTarget(target) {
    this.target = target;
    if (target) this.setProperty('targetID', target.id); // only broadcast if non-null
  }

  update() {
    if (this.inFight && (Date.now() - this.lastFightUpdate) >= GameServer.fightUpdateDelay) this.updateFight();
    if (this.route && (Date.now() - this.lastWalkUpdate) >= GameServer.walkUpdateDelay) this.updateWalk();
    if (this.constructor.name === 'Monster' && (Date.now() - this.lastPositionCheck) >= GameServer.positionCheckDelay) this.checkPosition();
  }

  updateWalk() {
    // Based on the speed of the entity and the time elapsed since it started moving along a path,
    // compute on which tile of the path it should be at this time. If path ended, check what should happen.
    this.lastWalkUpdate = Date.now();
    const previousX = this.x;
    const previousY = this.y;
    // this.speed is the amount of time need to travel a distance of 1 tile;
    // delta = the number of tiles traveled since departure
    let delta = Math.ceil(Math.abs(Date.now() - this.route.departureTime) / this.speed);
    const maxDelta = this.route.path.length - 1;
    if (delta > maxDelta) delta = maxDelta;
    this.setAtDelta(delta);
    if (delta == maxDelta) {
      if (this.constructor.name == 'Player') {
        GameServer.checkDoor(this);
        GameServer.checkItem(this);
        GameServer.checkAction(this);
        GameServer.checkSave(this);
        console.log(`${this.name} moved to ${this.x}, ${this.y}`);
      }
      this.route = undefined;
    }
    if (this.x != previousX || this.y != previousY) {
      GameServer.moveAtLocation(this, previousX, previousY, this.x, this.y);
      if (this.constructor.name == 'Player') GameServer.checkMonster(this);
    }
  }

  setAtDelta(delta) {
    // Update the position of an entity by putting at the delta'th tile along it's path (see updateWalk())
    if (!this.route.path) return;
    this.x = this.route.path[delta].x; // no -1 because it's done in updateWalk() aready
    this.y = this.route.path[delta].y;
  }

  startFight(target) {
    if (!this.alive || !target.alive) return;
    if (!this.target) this.setTarget(target);
    this.addFoe(target);
    this.setProperty('inFight', true);
  }

  damage() {
    if (!this.alive || !this.target || !this.target.alive) return;
    if ((Date.now() - this.lastDamage) < GameServer.damageDelay) return;
    this.lastDamage = Date.now();
    let damage = (this.atk * randomInt(5, 10)) - (this.target.def * randomInt(1, 3));
    damage = (damage <= 0 ? randomInt(1, 3) : damage);
    this.target.lastHitter = this;
    const target = this.target;
    const difference = Math.abs(this.target.updateLife(-damage)); // Avoid sending negative numbers for binary protocol
    if (this.constructor.name == 'Player') {
      this.updatePacket.addHP(true, difference); // true = target
      if (!target.alive) GameServer.handleKill(this, target);
    } else if (this.constructor.name == 'Monster') {
      target.updatePacket.addHP(false, difference, this.id); // false = self
    }
  }

  updateLife(incr) {
    const tmp = this.life;
    this.life += incr;
    if (this.life <= 0) {
      this.life = 0;
      this.die();
    } else if (this.life > this.maxLife) {
      this.life = this.maxLife;
    }
    const difference = this.life - tmp;
    if (this.constructor.name == 'Player') this.updatePacket.updateLife(this.life);
    return difference;
  }

  die() {
    this.manageFoes();
    if (this.lastHitter) this.setProperty('lastHitter', this.lastHitter.id);
    this.endFight();
    this.setProperty('alive', false);
    if (this.constructor.name == 'Monster') {
      GameServer.respawnCount(this.startX, this.startY, this, this.respawn, GameServer.monsterRespawnDelay);
      setTimeout(GameServer.dropLoot, 200, this.lootTable, this.x, this.y);
      if (this.chestArea) this.chestArea.decrement();
    }
  }

  endFight() {
    this.setProperty('inFight', false);
    this.setTarget(null);
  }

  manageFoes() {
    for (let i = 0; i < this.foes.length; i++) {
      const foe = this.foes[i];
      foe.endFight();
      foe.removeFoe(this);
      foe.switchOpponent();
    }
    this.foes = [];
  }

  hasFoe(foe) {
    return this.foes.indexOf(foe) > -1;
  }

  addFoe(foe) {
    const idx = this.foes.indexOf(foe);
    if (idx == -1) this.foes.push(foe);
  }

  removeFoe(foe) {
    const idx = this.foes.indexOf(foe);
    if (idx >= 0) this.foes.splice(idx, 1);
  }

  switchOpponent() {
    if (this.foes.length) {
      setTimeout((_entity) => {
        GameServer.setUpFight(_entity, _entity.foes[0]);
      }, 300, this);
    }
  }
}

module.exports = MovingEntity;
