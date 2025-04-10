import * as THREE from "three";
import * as Croquet from "@croquet/croquet";

// We use Three.js for 3D graphics and Croquet for multiplayer logic

// Croquet works by splitting the code into model and view:
// * The model is the shared simulation state.
// * The view is the interface between the simulation and the local client.

// The model takes on the role of server code in traditional multiplayer
// approaches. There is no need to implement any networking code or server-side code.

// Model code execution is synchronized across all clients in the session
// via Multisynq's synchronizer network, which feeds the exact same time
// and sequence of user input events to all clients.
// This ensures that all clients are executing the exact same code at the
// exact same time, so the simulation is deterministic and consistent.
// It also means that no state needs to be transmitted between clients, or
// be sent from the server to the clients. Instead, you can run e.g. physics
// or NPC code in the model, and it will be exactly the same for all clients.

// All constants used in the simulation must be defined as Croquet.Constants
// so that they get hashed into the session ID, ensuring that all clients
// in the same session use the same constants
const C = Croquet.Constants;
C.carSpeed = 0.15;
C.turnSpeed = 0.05;
C.trainSpeed = 0.01;
C.trainRadius = 30;

// Any Croquet app must be split into model and view.
// The model is the shared simulation state.
// The view is the interface between the simulation and the local client.

// The shared simulation model must be entirely self-contained
// and not depend on any state outside of it.
// This is to ensure that all clients have the same simulation state.

// Additionally, all code executed in the model must be identical on all
// clients. Croquet ensures that by hashing the model code into the session ID.
// If the model uses any external code, it must be added to Constants
// to get hashed, too. For external libraries, it's ususally sufficient
// to add their version number to Constants so if two clients have different
// versions of the same library, they will be in different sessions.

class SharedSimulation extends Croquet.Model {
    // Models are initialized with "init" instead of "constructor",
    // and created with "Class.create" instead of "new Class".
    // That's because when new clients join the session, models are
    // deserialized from a snapshot by populating all properties
    // with the values from the snapshot. In that case, the "init"
    // method is not called again. This happens automatically,
    // you don't need to do anything special.
    init() {
        // Generate mountains, trees, and clouds.
        // This uses Croquet's shared random number generator.
        this.mountains = this.createMountains(15);
        this.trees = this.createTrees(50);
        this.clouds = this.createClouds(20);

        // synchronize train angle
        this.trainAngle = 0;

        // We reate a new car model for each player, and store them
        // in a map so we can look them up by the player's view ID
        this.cars = new Map();

        // subscribe to view join and exit events
        // these are triggered when a new player joins or leaves the session
        this.subscribe(this.sessionId, "view-join", this.onViewJoin);
        this.subscribe(this.sessionId, "view-exit", this.onViewExit)

        // step the simulation 20 times per second
        this.step(50);
    }

    // this is called when a new player joins the session
    onViewJoin(viewId) {
        // create a new car model for the player
        const car = SimCar.create(viewId);
        // store the car model in a map so we can look it up by the player's view ID
        this.cars.set(viewId, car);
        // Inform the view that a new car has been added
        // This is not strictly necessary, but more efficient than
        // constantly checking in the view for new cars
        this.publish("sim", "car-added", car);
    }

    // this is called when a player leaves the session
    onViewExit(viewId) {
        // get the car model for the player
        const car = this.cars.get(viewId);
        // remove the car model from the map
        this.cars.delete(viewId);
        // destroy the car model
        car.destroy();
        // Inform the view that a car has been removed
        // Again, this is not strictly necessary, but more efficient than
        // constantly checking in the view for removed cars
        this.publish("sim", "car-removed", car);
    }

    // update the simulation based on simulation time
    step(ms) {
        // convert milliseconds to seconds
        const deltaTime = ms / 1000;
        // move the train
        this.moveTrain(deltaTime);
        // move all cars
        for (const car of this.cars.values()) {
            car.move(deltaTime);
        }
        // Schedule the next step.
        // We can't use setTimeout because that would break the deterministic
        // nature of the simulation
        this.future(100).step(ms);
    }

    // this is overly simplified, in a real game the train would have a more complex
    // path and would also need to be animated
    moveTrain(deltaTime) {
        this.trainAngle += C.trainSpeed * (deltaTime * 60); // Normalize speed
        if (this.trainAngle > Math.PI * 2) {
            this.trainAngle -= Math.PI * 2; // Loop the angle
        }
    }

    // this creates random mountains that are visible in the background
    createMountains(count) {
        const mountains = [];
        for (let i = 0; i < count; i++) {
            // We use the shared random number generator to ensure that all clients
            // get the same sequence of random numbers. It's automatically seeded
            // with the session ID, so different sessions will get different sequences.
            const height = this.random() * 30 + 10;
            const radius = this.random() * 10 + 5;
            const position = {
                x: (this.random() - 0.5) * 180, // Spread them out
                z: (this.random() - 0.5) * 180,
                y: height / 2, // Base on the ground plane
            };
            // Ensure mountains are far from the central road area
            if (Math.abs(position.x) < 20) position.x += Math.sign(position.x) * 20;
            mountains.push({ height, radius, position });
        }
        return mountains;
    }

    // random trees everywhere
    createTrees(count) {
        const trees = [];
        for (let i = 0; i < count; i++) {
            const trunkHeight = this.random() * 3 + 1;
            const trunkRadius = trunkHeight * 0.1;
            const leavesHeight = this.random() * 4 + 2;
            const leavesRadius = leavesHeight * 0.4;
            // Position the tree randomly, avoiding the road
            const tree = {
                trunk: {
                    height: trunkHeight,
                    radius: trunkRadius,
                },
                leaves: {
                    height: leavesHeight,
                    radius: leavesRadius,
                },
                position: {
                    x: (this.random() - 0.5) * 150,
                    z: (this.random() - 0.5) * 150,
                    y: 0,
                },
            };
            // Ensure trees are off the road (road width is 8, give some buffer)
            if (Math.abs(tree.position.x) < 6) {
                tree.position.x += Math.sign(tree.position.x || 1) * 6; // Move it away if too close
            }
            trees.push(tree);
        }
        return trees;
    }

    // random clouds in the sky
    createClouds(count) {
        const clouds = [];
        for (let i = 0; i < count; i++) {
            const numSpheres = Math.floor(this.random() * 5) + 3; // 3 to 7 spheres per cloud
            const spheres = [];
            for (let j = 0; j < numSpheres; j++) {
                const radius = this.random() * 5 + 2;
                // Offset spheres slightly to form cloud shape
                const position = {
                    x: (this.random() - 0.5) * 10,
                    z: (this.random() - 0.5) * 5,
                    y: (this.random() - 0.5) * 3,
                };
                spheres.push({ radius, position });
            }
            // Position the cloud group high up and spread out
            const position = {
                x: (this.random() - 0.5) * 180,
                z: (this.random() - 0.5) * 180,
                y: this.random() * 20 + 30, // Height range
            };
            clouds.push({ spheres, position });
        }
        return clouds;
    }
}
SharedSimulation.register("SharedSimulation");


// a new SimCar model is created for each player joining the session
class SimCar extends Croquet.Model {
    // each player's view has a viewId property, which we use to identify
    // the player controlling the car
    init(viewId) {
        // this is in addition to the `id` property every model already has
        this.viewId = viewId;
        // each car has a random color
        this.color = `hsl(${this.random() * 360}, 100%, 50%)`;
        // each car has a slightly random position so they don't all
        // spawn in the exact same place
        this.pos = {
            x: this.random() * 4 - 2,
            z: this.random() * 4 - 2,
            y: 0.2,
        };
        // all cars facing forward
        this.angle = 0;
        // we use simple push-button controls for the car
        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false
        };
        // Subscribe to control events only from "our" player
        this.subscribe(viewId, "control", this.onControl);
    }

    // this event is published when the player presses a button
    // every client processes the exact same event at the exact same
    // simulation time, so the simulation is deterministic
    onControl({ control, value }) {
        this.controls[control] = value;
    }

    // these helpers return the speed and turn speed of the car
    // based on the currently pressed controls
    // Note that the car only turns when it is moving, just like in real life
    get speed() { return this.controls.forward ? 1 : this.controls.backward ? -0.5 : 0; }
    get turn() { return this.controls.left ? this.speed : this.controls.right ? -this.speed : 0; }

    // this is a helper to get the simulation model so we can
    // access the other cars for collision detection
    get sim () { return this.wellKnownModel("modelRoot"); }

    move(deltaTime) {
        // advance the car's angle based on the player's input
        const turn = C.turnSpeed * this.turn * (deltaTime * 60); // Normalize turn
        this.angle = (this.angle + turn) % (Math.PI * 2); // Loop the angle

        // advance the car's position based on the player's input
        const speed = C.carSpeed * this.speed * (deltaTime * 60); // Normalize speed
        const z = speed * Math.cos(this.angle);
        const x = speed * Math.sin(this.angle);
        this.pos.z += z;
        this.pos.x += x;

        // check collision with other cars
        // This could be way more sophisticated, but it's just an example
        for (const otherCar of this.sim.cars.values()) {
            if (otherCar !== this && this.distanceTo(otherCar) < 2) {
                // if the car is too close to another car, push it away
                // in the direction this car is moving
                otherCar.pos.z += 10 * z;
                otherCar.pos.x += 10 * x;
                // we could publish an event here so the view could play a sound
                // or show a visual effect
            }
        }
    }

    // we could also use Three.js math here, but would have to define the
    // serialization of Vectors, Quaternions, etc. using a static `types` method
    distanceTo(otherCar) {
        return Math.sqrt(
            (this.pos.x - otherCar.pos.x) ** 2 +
            (this.pos.z - otherCar.pos.z) ** 2
        );
    }
}
SimCar.register("SimCar");

// We use a Croquet View as the Interface between shared simulation and local
// Three.js scene. We can read state directly from the simulation model, but
// must not modify it. Any manipulation of the simulation state must be via
// `publish` operations to ensure it stays synchronized across all clients

class SimInterface extends Croquet.View {
    constructor(sim) {
        super(sim);
        // This is a direct reference to the simulation model.
        // We can use it to read state, but we must not modify it
        // in any way
        this.sim = sim;

        // Basic Scene Setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 150); // Add fog

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            200
        );
        this.camera.position.set(0, 5, -10); // Initial position slightly behind where the car will be
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true; // Enable shadows
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // --- Fixed Objects (exist only in Interface) ---

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 25);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 200;
        this.scene.add(directionalLight);

        // Ground
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x55aa55,
            side: THREE.DoubleSide
        }); // Green
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2; // angleate flat
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Road
        const roadGeometry = new THREE.PlaneGeometry(8, 200); // Narrow and long
        const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 }); // Dark grey
        const road = new THREE.Mesh(roadGeometry, roadMaterial);
        road.rotation.x = -Math.PI / 2;
        road.position.y = 0.01; // Slightly above ground
        road.receiveShadow = true;
        this.scene.add(road);

        // --- Shared Objects (read from Model once) ---

        this.makeMountainsFromSim();
        this.makeTreesFromSim();
        this.makeCloudsFromSim();

        // --- Dynamic Objects (controlled by Model) ---

        this.train = this.createTrain();
        this.train.position.y = 0.2; // Slightly above ground
        this.scene.add(this.train);
        this.trainAngle = this.sim.trainAngle; // initial train angle from model

        // Create 3D objects for all cars already in sim (includes ours)
        this.carObjects = new Map();
        for (const simCar of this.sim.cars.values()) {
            this.onCarAdded(simCar);
        }

        // get the car we control based on our viewId
        this.mySimCar = sim.cars.get(this.viewId);

        // When a new player's car is added, we add a new 3D object to our scene
        this.subscribe("sim", "car-added", this.onCarAdded);
        // When a player's car is removed, we remove the 3D object from our scene
        this.subscribe("sim", "car-removed", this.onCarRemoved);

        window.onresize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        };
    }

    // this is called when the session is interrupted
    detach() {
        this.renderer.dispose();
        super.detach();
    }

    // this is called both in the constructor and when a new player's car is added
    onCarAdded(simCar) {
        const carObj = this.createCar(simCar);
        this.carObjects.set(simCar.viewId, carObj);
        this.scene.add(carObj);
    }

    onCarRemoved(simCar) {
        const carObj = this.carObjects.get(simCar.viewId);
        if (carObj) {
            this.scene.remove(carObj);
            this.carObjects.delete(simCar.viewId);
        }
    }

    // this is called by Croquet in every frame (driven by requestAnimationFrame)
    update(_time) {
        this.updateTrain(this.sim.trainAngle);
        this.updateCars(this.carObjects, this.sim.cars);
        this.updateCamera(this.carObjects.get(this.viewId));

        this.renderer.render(this.scene, this.camera);
    }

    // update train 3D object based on the train's angle from the simulation model
    updateTrain(simTrainAngle) {
        // the simulation runs at a lower frame rate than the interface, so we
        // need to lerp the train angle to smooth out the movement
        this.trainAngle = this.lerpAngle(this.trainAngle, simTrainAngle, 0.1);

        // update the train's position
        const trainX = Math.cos(this.trainAngle) * C.trainRadius;
        const trainZ = Math.sin(this.trainAngle) * C.trainRadius;
        this.train.position.x = trainX;
        this.train.position.z = trainZ;

        // Make train face forward
        const nextAngle = this.trainAngle + 0.01; // Look slightly ahead
        const nextX = Math.cos(nextAngle) * C.trainRadius;
        const nextZ = Math.sin(nextAngle) * C.trainRadius;
        this.train.lookAt(nextX, this.train.position.y, nextZ);
    }

    // update all cars 3D objects based on the cars' positions and angles from the simulation model
    updateCars(carObjs, simCars) {
        for (const [id, carObj] of carObjs) {
            const simCar = simCars.get(id);
            if (simCar) {
                // Smoothly interpolate rotation
                let prevAngle = carObj.userData.angle;
                let newAngle = this.lerpAngle(prevAngle, simCar.angle, 0.1);
                carObj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), newAngle);
                carObj.userData.angle = newAngle;
                // Smoothly interpolate position
                carObj.position.lerp(simCar.pos, 0.1);
            }
        }
    }

    // update the camera to follow the car we control
    updateCamera(car) {
        if (!car || !car.userData.cameraTarget) return;

        // we are not in the model so can use Three.js math directly
        const targetPosition = new THREE.Vector3();
        // Get the world position of the invisible target object added to the car group
        car.userData.cameraTarget.getWorldPosition(targetPosition);

        // Smoothly interpolate camera position towards the target
        this.camera.position.lerp(targetPosition, 0.05);

        // Always look at the car's main body position
        const lookAtPosition = new THREE.Vector3();
        car.getWorldPosition(lookAtPosition); // Get car's world position
        lookAtPosition.y += 0.5; // Look slightly above the car's base
        this.camera.lookAt(lookAtPosition);
    }

    makeMountainsFromSim() {
        // Mountains (randomly generated in the sim model)
        const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // Brown
        const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White snow caps
        for (const { height, radius, position } of this.sim.mountains) {
            const mountainGeometry = new THREE.ConeGeometry(radius, height, 8); // Low poly cone
            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
            mountain.position.set(position.x, position.y, position.z);
            mountain.castShadow = true;
            this.scene.add(mountain);

            // Add snow cap
            if (height > 25) {
                const snowHeight = height * 0.3;
                const snowRadius = radius * (snowHeight / height) * 0.8; // Tapered snow cap
                const snowGeometry = new THREE.ConeGeometry(snowRadius, snowHeight, 8);
                const snowCap = new THREE.Mesh(snowGeometry, snowMaterial);
                snowCap.position.y = height - snowHeight * 2; // Position at top
                mountain.add(snowCap); // Add as child
            }
        }
    }

    makeTreesFromSim() {
        // Trees (randomly generated in the sim model)
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 }); // Brown
        const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x228b22 }); // Forest Green
        for (const { trunk, leaves, position } of this.sim.trees) {
            const tree = new THREE.Group();
            // Trunk
            const trunkGeometry = new THREE.CylinderGeometry(
                trunk.radius * 0.7,
                trunk.radius,
                trunk.height,
                8
            );
            const trunkMesh = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunkMesh.position.set(position.x, trunk.height / 2, position.z);
            trunkMesh.castShadow = true;
            tree.add(trunkMesh);
            // Leaves
            const leavesGeometry = new THREE.ConeGeometry(
                leaves.radius,
                leaves.height,
                6
            );
            const leavesMesh = new THREE.Mesh(leavesGeometry, leavesMaterial);
            leavesMesh.position.set(
                position.x,
                trunk.height + leaves.height / 2 - 0.2, // Sit on top of trunk
                position.z);
            leavesMesh.castShadow = true;
            tree.add(leavesMesh);
            // Add tree to scene
            this.scene.add(tree);
        }
    }

    makeCloudsFromSim() {
        // Clouds (randomly generated in the sim model)
        const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        for (const { spheres, position: cloudPosition } of this.sim.clouds) {
            const cloud = new THREE.Group();
            for (const { radius, position: spherePosition } of spheres) {
                const sphereGeometry = new THREE.SphereGeometry(radius, 8, 8);
                const sphereMesh = new THREE.Mesh(sphereGeometry, cloudMaterial);
                sphereMesh.position.copy(spherePosition);
                cloud.add(sphereMesh);
            }
            cloud.position.copy(cloudPosition);
            this.scene.add(cloud);
        }
    }

    // The train is a very simple simulation, it only has an angle in the model
    // Here we create a 3D object for it that will be updated every frame in the `updateTrain` method
    createTrain() {
        const trainGroup = new THREE.Group();

        const colors = [0x4444ff, 0xffaa00, 0x44ff44]; // Blue engine, orange, green cars
        const carLength = 5;
        const carWidth = 2;
        const carHeight = 1.8;
        const gap = 0.5;

        for (let i = 0; i < 3; i++) {
            const carGeometry = new THREE.BoxGeometry(carWidth, carHeight, carLength);
            const carMaterial = new THREE.MeshStandardMaterial({ color: colors[i] });
            const trainCar = new THREE.Mesh(carGeometry, carMaterial);
            trainCar.position.z = -(i * (carLength + gap)); // Position cars behind each other
            trainCar.castShadow = true;
            trainCar.receiveShadow = true;
            trainGroup.add(trainCar);

            // Simple wheels for each car
            const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 8);
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
            const wheelPositions = [
                { x: carWidth / 2 + 0.1, z: carLength / 2 - 0.5 },
                { x: carWidth / 2 + 0.1, z: -carLength / 2 + 0.5 },
                { x: -carWidth / 2 - 0.1, z: carLength / 2 - 0.5 },
                { x: -carWidth / 2 - 0.1, z: -carLength / 2 + 0.5 }
            ];
            wheelPositions.forEach((pos) => {
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.rotation.x = Math.PI / 2;
                wheel.position.set(
                pos.x,
                -carHeight / 2 + 0.4,
                trainCar.position.z + pos.z
                );
                wheel.castShadow = true;
                trainGroup.add(wheel);
            });
        }
        return trainGroup;
    }

    // This creates a 3D object for a car from a simulation car object
    // it will be updated every frame in the `updateCars` method
    createCar(simCar) {
        const carGroup = new THREE.Group();
        carGroup.userData.angle = simCar.angle;
        carGroup.position.copy(simCar.pos);
        carGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), simCar.angle);

        // Body
        const bodyGeometry = new THREE.BoxGeometry(1.5, 0.6, 3);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: simCar.color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.3;
        body.castShadow = true;
        carGroup.add(body);

        // Cabin
        const cabinGeometry = new THREE.BoxGeometry(1.3, 0.5, 1.5);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc }); // Light grey
        const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
        cabin.position.set(0, 0.75, -0.3); // y = body.y + body.height/2 + cabin.height/2
        cabin.castShadow = true;
        carGroup.add(cabin);

        // Wheels
        const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 16);
        const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Dark grey/black

        const wheelPositions = [
            { x: 0.8, y: 0, z: 1.0 }, // Front right
            { x: -0.8, y: 0, z: 1.0 }, // Front left
            { x: 0.8, y: 0, z: -1.0 }, // Back right
            { x: -0.8, y: 0, z: -1.0 } // Back left
        ];

        wheelPositions.forEach((pos) => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.rotation.z = Math.PI / 2; // angleate to stand upright
            wheel.position.set(pos.x, pos.y + 0.15, pos.z); // Adjust y based on radius
            wheel.castShadow = true;
            carGroup.add(wheel);
        });

        // Add invisible object for camera tracking point slightly behind the car
        const cameraTarget = new THREE.Object3D();
        cameraTarget.position.set(0, 2, -5); // Behind and slightly above
        carGroup.add(cameraTarget);
        carGroup.userData.cameraTarget = cameraTarget; // Store reference

        return carGroup;
    }

    // Linear interpolation between two angles to smooth out the movement
    // pay special attention to the wrap-around
    lerpAngle(a, b, t) {
        if (a - b > Math.PI) a -= Math.PI * 2;
        if (a - b < -Math.PI) a += Math.PI * 2;
        return a + (b - a) * t;
    }
}


// We put the controls outside the SimInterface class because we want to
// subscribe to the DOM events only once. Otherwise we would have to unsubscribe
// and remove the event listeners in the `detach` method, and that would be
// cumbersome. Instead, we check if the view is still attached before publishing
// to the model by checking the `view` property of the session object.

// User Input published via view
// This will publish the control state to the model whenever one of the controls changes
const myControls = {
    forward: false,
    backward: false,
    left: false,
    right: false,

    set(control, value) {
        if (this[control] === value) return; // No change
        this[control] = value;
        const { view } = ThisSession;
        if (view) {
            view.publish(view.viewId, "control", { control, value });
        }
    }
};

// This is the interface between the user and the simulation
// we use the same principle for touch and keyboard controls
function setupControls() {
    const btnFwd = document.getElementById("btn-fwd");
    const btnBwd = document.getElementById("btn-bwd");
    const btnLeft = document.getElementById("btn-left");
    const btnRight = document.getElementById("btn-right");

    const touchStartHandler = (control) => (e) => {
        e.preventDefault();
        myControls.set(control, true);
    };
    const touchEndHandler = (control) => (e) => {
        // Check if any remaining touches are on the *same* button
        let stillTouching = false;
        if (e.touches) {
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].target === e.target) {
                    stillTouching = true;
                    break;
                }
            }
        }
        if (!stillTouching) {
            myControls.set(control, false);
        }
    };

    btnFwd.addEventListener("touchstart", touchStartHandler("forward"), { passive: false });
    btnBwd.addEventListener("touchstart", touchStartHandler("backward"), { passive: false });
    btnLeft.addEventListener("touchstart", touchStartHandler("left"), { passive: false });
    btnRight.addEventListener("touchstart", touchStartHandler("right"), { passive: false });
    btnFwd.addEventListener("touchend", touchEndHandler("forward"));
    btnBwd.addEventListener("touchend", touchEndHandler("backward"));
    btnLeft.addEventListener("touchend", touchEndHandler("left"));
    btnRight.addEventListener("touchend", touchEndHandler("right"));
    btnFwd.addEventListener("touchcancel", touchEndHandler("forward"));
    btnBwd.addEventListener("touchcancel", touchEndHandler("backward"));
    btnLeft.addEventListener("touchcancel", touchEndHandler("left"));
    btnRight.addEventListener("touchcancel", touchEndHandler("right"));

    // Prevent scrolling on the controls themselves
    document.querySelector(".controls").addEventListener(
        "touchmove",
        (e) => {  e.preventDefault();  },
        { passive: false }
    );

    // Keyboard controls
    const keys = {
        w: "forward",  "arrowup": "forward",
        a: "left",     "arrowleft": "left",
        s: "backward", "arrowdown": "backward",
        d: "right",    "arrowright": "right",
    };
    window.addEventListener("keydown", (e) => {
        const dir = keys[e.key.toLowerCase()];
        if (dir) myControls.set(dir, true);
    });
    window.addEventListener("keyup", (e) => {
        const dir = keys[e.key.toLowerCase()];
        if (dir) myControls.set(dir, false);
    });

    // Could add mouse controls here if we wanted but the simple boolean
    // approach of pressed/not pressed is very efficient with network traffic
}

// The widget dock shows the QR code for the session
// URL so other players can join easily
Croquet.App.makeWidgetDock();

// This is the main entry point for the application
// it joins the session, resumes the simulation, and attaches the view to it
// The Multisynq API key here is a placeholder that will work on the local network
// but not on the public internet. Before deploying your own game, please create
// your own API key at multisynq.io/coder and use that instead.
const ThisSession = await Croquet.Session.join({
    apiKey: "234567_Paste_Your_Own_API_Key_Here_7654321",
    appId: "io.croquet.threejs",
    model: SharedSimulation,
    view: SimInterface,
});

// start listening for user input
setupControls();