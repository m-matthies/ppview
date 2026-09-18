/**
 * Helpers shared by the key = value style topology files (Flavio).
 */
import * as THREE from 'three';

export const getScalar = (name, s) => {
  const m = s.match(new RegExp(`${name}=(-?\\d+)`));
  if (m) {
    return parseFloat(m[1]);
  }
  return false;
};

export const getArray = (name, s) => {
  const m = s.match(new RegExp(`${name}=([\\,\\d\\.\\-\\+]+)`));
  if (m) {
    return m[1].split(',').map((v) => parseFloat(v));
  }
  return false;
};

// Function to parse particle.txt (following initSpecies logic)
export const parseParticleTxt = (content) => {
  // Remove whitespace following initSpecies pattern
  const particlesStr = content.replaceAll(' ', '');
  const particles = [];
  let currentParticle = null;

  for (const line of particlesStr.split('\n')) {
    const particleID = line.match(/particle_(\d+)/);
    if (particleID) {
      if (currentParticle) {
        particles.push(currentParticle);
      }
      currentParticle = { 'id': parseInt(particleID[1]) };
    }

    const type = getScalar('type', line);
    if (type !== false) {
      currentParticle['type'] = type;
    }

    const patches = getArray('patches', line);
    if (patches !== false) {
      currentParticle['patches'] = patches;
    }
  }

  if (currentParticle) {
    particles.push(currentParticle);
  }

  return particles;
};

// Function to parse patches.txt (following initSpecies logic)
export const parsePatchesTxt = (content) => {
  // Remove whitespace following initSpecies pattern
  const patchesStr = content.replaceAll(' ', '');
  const patches = new Map();
  let currentId;

  for (const line of patchesStr.split('\n')) {
    const patchID = line.match(/patch_(\d+)/);
    if (patchID) {
      currentId = parseInt(patchID[1]);
      patches.set(currentId, {});
    }

    const color = getScalar('color', line);
    if (color !== false) {
      patches.get(currentId)['color'] = color;
    }

    // Handle position, a1, and a2 arrays
    for (const k of ['position', 'a1', 'a2']) {
      const a = getArray(k, line);
      if (a) {
        // Convert to THREE.Vector3 following initSpecies pattern
        const v = new THREE.Vector3().fromArray(a);
        patches.get(currentId)[k] = v;
      }
    }
  }

  // Convert Map to object for compatibility with existing code
  const patchesData = {};
  patches.forEach((patch, id) => {
    patchesData[id] = {
      id: id,
      color: patch.color || 0,
      position: patch.position ? {
        x: patch.position.x,
        y: patch.position.y,
        z: patch.position.z
      } : null,
      a1: patch.a1 ? {
        x: patch.a1.x,
        y: patch.a1.y,
        z: patch.a1.z
      } : null,
      a2: patch.a2 ? {
        x: patch.a2.x,
        y: patch.a2.y,
        z: patch.a2.z
      } : null
    };
  });

  return patchesData;
};

// Function to parse Lorenzo's topology (following initLoroSpecies logic)
