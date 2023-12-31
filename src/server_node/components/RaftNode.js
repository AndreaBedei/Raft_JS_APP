import { createServer, Server as HTTPServer } from "http";
import { Server } from "socket.io";
import { Socket as SocketCl, io } from "socket.io-client"
import { RPCType } from "../enums/RPCType.js";
import { AppendEntriesParameters, RequestVoteParameters, SnapshotParameters } from "./RPCParameters.js";
import { State } from "../enums/State.js";
import { RPCManager } from "./RPCManager.js";
import { LogRecord, AuctionCreateData, AuctionCloseData, UserCreateData, BidCreateData } from "./Log.js";
import { DBManager } from "./DBManager.js";
import { CommandType } from "../enums/CommandType.js";
import { WebServerManager } from "./WebServerManager.js";

export class RaftNode {
    /**
     * Creates a new node for the Raft consensus protocol cluster.
     * @param {String} id Id of this node.
     * @param {Number} portNodeProt Port of the protocol Node.
     * @param {Number} portWebServer Port of the web Server.
     * @param {Number} minLeaderTimeout Minimum time in ms to wait before launching a new election after a leader timeout.
     * @param {Number} maxLeaderTimeout Maximum time in ms to wait before launching a new election after a leader timeout.
     * @param {Number} minElectionTimeout Minimum time in ms to wait before launching a new election after a failed one.
     * @param {Number} maxElectionTimeout Maximum time in ms to wait before launching a new election after a failed one.
     * @param {Number} minElectionDelay Minimum time in ms before a new election can be started. Elections started before this amount of time are ignored.
     * @param {Number} heartbeatTimeout Time in ms before sending a new heartbeat.
     * @param {String} hostForDB Hostname or IP address for the database connection.
     * @param {String} userForDB Database user.
     * @param {String} passwordForDB Database password.
     * @param {String} databaseName Name of the database.
     * @param {Map<String, String>} otherNodes Pairs IPAddress-IdNode for the other nodes in the cluster.
     * @param {boolean} [debug=false] Flag indicating whether debugging is enabled.
     * @param {boolean} [disabledDB=false] Flag indicating whether DB is disabled or not.
     */
    constructor(id, portNodeProt, portWebServer, minLeaderTimeout, maxLeaderTimeout, minElectionTimeout, maxElectionTimeout, minElectionDelay, heartbeatTimeout, hostForDB, userForDB, passwordForDB, databaseName, otherNodes, debug = false, disabledDB = false) {
        /** @type {String} */
        this.id = id;
        /** @type {Number} */
        this.portNodeProt = portNodeProt;
        /** @type {Boolean} */
        this.started = false;
        /** @type {String} */
        this.state = State.FOLLOWER;
        /** @type {Number} */
        this.currentTerm = 0;
        /** @type {String} */
        this.votedFor = null;
        /** @type {Number} */
        this.votesGathered = 0;
        /** @type {LogRecord[]} */
        this.log = [];
        /** @type {Number} */
        this.commitIndex = -1;
        /** @type {Number} */
        this.lastApplied = -1;
        /** @type {Number} */
        this.minLeaderTimeout = minLeaderTimeout;
        /** @type {Number} */
        this.maxLeaderTimeout = maxLeaderTimeout;
        /** @type {Number} */
        this.minElectionTimeout = minElectionTimeout;
        /** @type {Number} */
        this.maxElectionTimeout = maxElectionTimeout;
        /** @type {Number} */
        this.minElectionDelay = minElectionDelay;
        /** @type {Number} */
        this.heartbeatTimeout = heartbeatTimeout;

        if (!disabledDB) {
            /** @type {DBManager} */
            this.dbManager = new DBManager(hostForDB, userForDB, passwordForDB, databaseName);
        }

        /** @type {WebServerManager} */
        this.webServerManager = new WebServerManager(this, portWebServer);

        /**
         * Leader-only.
         * 
         * Index of the next log entry to send to each follower node, initialized after every election to the index of the last record in the leader's log +1.
         * @type {Map<String, Number>}
         */
        this.nextIndex = new Map();
        /**
         * Leader-only.
         * 
         * Index of highest log entry known to be replicated on each follower node. Reinitialized after every election. 
         * @type {Map<String, Number>}
         */
        this.matchIndex = new Map();
        /**
         * Leader-only.
         * 
         * Index of highest log entry known to be sent to each follower node. Reinitialized after every election. 
         * @type {Map<String, Number>}
         */
        this.lastSent = new Map();
        /**
         * Contains pairs IP Address - Node id 
         * @type {Map<String, String>}
         */
        this.otherNodes = otherNodes;

        /** @type {Number} */
        this.clusterSize = otherNodes.size + 1;

        /** @type {String | null} */
        this.currentLeaderId = null;

        /** @type {Map<String, Number | null>} */
        this.heartbeatTimeouts = new Map();

        /** @type {Server | null} */
        this.protocolServer = null;

        /** 
         * Maps the socket id to the corresponding node id. 
         * @type {Map<String, String>} 
        */
        this.socketToNodeId = new Map();

        /**
         * Maps the node id to the corresponding socket.
         *  @type {Map<String, SocketCl>} 
        */
        this.sockets = new Map();

        /** @type {Number} */
        this.leaderTimeout = null;

        /** @type {Number} */
        this.electionTimeout = null;

        /** @type {RPCManager} */
        this.rpcManager = new RPCManager(this.sockets, this.id);

        /** @type {Map<String, Number>} */
        this.nodeIdToMessageNum = new Map();
        this.lastMessageNum = -1;

        /** @type {Boolean} */
        this.debug = debug;

        /** @type {Boolean} */
        this.disabledDB = disabledDB;
    }

    /**
     * Starts the node.
     */
    start() {
        if (this.started) {
            throw new Error("Node is already active.");
        }

        this.started = true;

        this.debugLog("Starting node...");

        if (!this.disabledDB) {
            // Connect the node to the database through its DBmanager.
            this.dbManager.connect();
        }

        this.protocolServer = new Server({
            pingTimeout: 1000 * 60 * 10,
            pingInterval: 1000 * 60 * 10

        });

        let serverNode = this;


        this.protocolServer.on("connection", socket => {    // Handle connections to this node.
            if (serverNode.sockets.get(socket.handshake.auth.token) != undefined) {
                socket.emit("accept");
            } else {
                socket.disconnect(true);    // Connections from addresses not in the configuration are closed immediately.
                return;
            }

            socket.on(RPCType.APPENDENTRIES, args => this.onAppendEntriesMessage(args));
            socket.on(RPCType.REQUESTVOTE, args => this.onRequestVoteMessage(args));
            // socket.on(RPCType.SNAPSHOT, args => this.onSnapshotMessage(socket, args));

            serverNode.heartbeatTimeouts.set(serverNode.socketToNodeId.get(socket.id), null);
        });

        this.protocolServer.listen(this.portNodeProt);
        this.debugLog("Protocol server listening on port " + this.portNodeProt);

        this.webServerManager.start();
        this.debugLog("Web server listening on port " + this.webServerManager.webServerPort);

        // Connect to other nodes.
        this.otherNodes.forEach((id, host) => {
            this.debugLog("Connecting to " + id);


            let sock = io("ws://" + host, {
                autoConnect: false,
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                auth: { token: this.id }
            });

            sock.connect();

            let accepted = false;
            // let shutdown = false;

            sock.on("connect", () => {
                this.debugLog("Connection established with %s.", id);
            });

            sock.on("accept", () => {
                accepted = true;
                this.debugLog("Connection accepted.");
            });

            sock.on("connect_error", (err) => {
                this.debugLog("Failed to connect: " + err.message);
            });

            // sock.on("shutdown", () => {
            //     shutdown = true;
            // });

            sock.on("disconnect", (reason) => {
                if (reason === "io server disconnect") {         // Disconnected because not in configuration.
                    if (accepted) {
                        this.debugLog("Server shutdown");
                    } else {
                        this.debugLog("Connection refused by server.");
                    }
                } else {
                    this.debugLog("Disconnected from %s, reason: '%s', attempting reconnection...", id, reason);
                }
            });

            this.sockets.set(id, sock);
            this.socketToNodeId.set(sock.id, id);
            this.nodeIdToMessageNum.set(id, 0);
        });

        this.debugLog("Node started.");

        this.waitForLeaderTimeout();    // Waits before attempting to start the first ever election.
    }

    /**
     * Stops the node gracefully by closing all connections.
     */
    stop() {
        if (!this.started) {
            throw new Error("Node is not active.");
        }

        this.started = false;

        this.debugLog("Stopping node...");

        this.stopElectionTimeout();
        this.stopHeartbeatTimeout();
        this.stopLeaderTimeout();

        if (!this.disabledDB) {
            // Disconnect the node to the database through its DBmanager.
            this.dbManager.disconnect();
        }

        this.protocolServer.close();
        this.protocolServer.disconnectSockets(true);

        this.webServerManager.stop();

        this.sockets.forEach((s) => s.disconnect());

        this.sockets.clear();
        this.socketToNodeId.clear();

        this.debugLog("Node stopped");
    }

    /**
     * Applies a log entry at the given index.
     * @param {Number} index The index of the log entry to apply.
     */
    async applyLogEntry(index) {
        let logEntry = this.log.at(index);

        if (logEntry) {
            /** @type {Promise} */
            let res = null;
            switch (logEntry.commandType) {
                case CommandType.NEW_USER: {
                    /** @type {UserCreateData} */
                    let data = logEntry.logData;

                    if (!this.disabledDB) {
                        res = await this.dbManager.queryAddNewUser(data.username, data.password);
                    }
                    this.debugLog("Added new user to database.");
                    break;
                }
                case CommandType.NEW_AUCTION: {
                    /** @type {AuctionCreateData} */
                    let data = logEntry.logData;

                    if (!this.disabledDB) {
                        res = await this.dbManager.queryAddNewAuction(data.username, data.startDate, data.objName, data.objDesc, data.startPrice);
                    }
                    this.debugLog("Added new auction to database.");
                    break;
                }
                case CommandType.CLOSE_AUCTION: {
                    /** @type {AuctionCloseData} */
                    let data = logEntry.logData;

                    if (!this.disabledDB) {
                        res = await this.dbManager.queryCloseAuction(data.auctionId, data.closingDate);
                    }
                    this.debugLog("Closed auction in database.");
                    break;
                }
                case CommandType.NEW_BID: {
                    /** @type {BidCreateData} */
                    let data = logEntry.logData;

                    if (!this.disabledDB) {
                        res = await this.dbManager.queryAddNewBid(data.username, data.auctionId, data.value);
                    }
                    this.debugLog("Added new bid to database.");
                    break;
                }
                default: {
                    throw new Error("Unknown command type '" + logEntry.commandType + "'");
                }
            }
            if(this.state == State.LEADER){
                this.debugLog("Leader COMMIT");
            } else{
                this.debugLog("Client COMMIT");
            }
            if (logEntry.callback) {
                logEntry.callback(res); // Fulfill promise to web server by sending another promise.
                logEntry.callback = null; 
            } 
        } else {
            throw new Error("Log entry at index " + index + "is undefined.");
        }
    }

    /**
     * Checks if there are log entries that need to be applied and applies them.
     */
    applyLogEntries() {
        if (this.commitIndex > this.lastApplied) {
            for (let i = this.lastApplied + 1; i <= this.commitIndex; i++) {
                this.applyLogEntry(i);
            }

            this.debugLog("Committed %d log entries to database.", this.commitIndex - this.lastApplied);
            this.lastApplied = this.commitIndex;
        }
    }

    /**
     * Handles incoming AppendEntries RPC messages.
     * @param {AppendEntriesParameters} args The parameters of the AppendEntries RPC.
     */
    onAppendEntriesMessage(args) {
        this.debugLog("/-----------------------------------------------------------------------------\\");
        this.debugLog("(%s): %s", RPCType.APPENDENTRIES, JSON.stringify(args));
        this.debugLog("\\-----------------------------------------------------------------------------/");

        let senderSocket = this.sockets.get(args.senderId);
        if (args.term > this.currentTerm) {     // Contact from a more recent leader.
            switch (this.state) {
                case State.LEADER: {        // Stops waiting for heartbeat timeout because it's no longer the leader.
                    this.stopHeartbeatTimeout();
                    break;
                }
                case State.CANDIDATE: {     // Stops waiting for heartbeat and election timeout because it's no longer a candidate.
                    this.stopHeartbeatTimeout();
                    this.stopElectionTimeout();
                    break;
                }
                default:
                    break;
            }
            this.state = State.FOLLOWER;
            this.currentLeaderId = args.isResponse ? null : args.senderId;
            this.currentTerm = args.term;
            this.lastMessageNum = -1;
            this.resetLeaderTimeout();
            this.webServerManager.disconnectSockets();

            this.debugLog("New leader detected (%s). Changing to %s state...", args.senderId ?? "unknown", State.FOLLOWER);
        }

        switch (this.state) {
            case State.FOLLOWER: {
                if (args.isResponse) {
                    this.debugLog("Received \"%s\" response from %s -> ignored.", RPCType.APPENDENTRIES, args.senderId);
                    break;
                }

                if (args.messageNum <= this.lastMessageNum) {
                    this.debugLog("Received \"%s\" request with old message number (%s, expected %s) -> ignored.", RPCType.APPENDENTRIES, args.senderId, args.messageNum, this.lastMessageNum);
                    break;
                }

                if (args.term < this.currentTerm) {
                    this.rpcManager.sendReplicationResponse(senderSocket, this.currentTerm, false, this.commitIndex, this.lastApplied);    
                    this.debugLog("Received %s message from %s with previous term %d -> refused.", RPCType.APPENDENTRIES, args.senderId, args.term);
                    break;
                }

                if (args.prevLogIndex >= 0) {
                    let logEntry = this.log.at(args.prevLogIndex);
                    if (logEntry == null) {
                        this.rpcManager.sendReplicationResponse(senderSocket, this.currentTerm, false, this.commitIndex, this.lastApplied);
                        this.debugLog("Received %s message from %s with prevLogIndex (%s) that is not in the log.", RPCType.APPENDENTRIES, args.senderId, args.prevLogIndex);
                        this.resetLeaderTimeout();
                        break;
                    }
                }
                
                if (this.currentLeaderId == null) {            // Leader may not be known (see in case State.LEADER)
                    this.currentLeaderId = args.senderId;
                    this.debugLog("Discovered leader: %s.", args.senderId);
                } else {
                    if (this.currentLeaderId != args.senderId) {    // Invalid leader trying to act as one.
                        this.debugLog("Received %s message from %s who is not supposed to be a leader -> ignored.", RPCType.APPENDENTRIES, args.senderId);
                        break;
                    }
                }

                this.lastMessageNum = args.messageNum;

                if (args.entries.length > 0) {
                    args.entries.forEach((e, i) => {
                        let newEntryIndex = args.prevLogIndex + i + 1;
                        if (this.log[newEntryIndex] && this.log[newEntryIndex].term !== e.term) {
                            let oldLogLength = this.log.length;
                            this.log.length = newEntryIndex;        // Delete all records starting from the conflicting one.
                            this.commitIndex = this.log.length - 1;
                            this.debugLog("Conflicting entry/ies found and removed from log. Log length %d -> %d.", oldLogLength, this.log.length);
                            
                            let oldLastApplied = this.lastApplied;
                            this.lastApplied = Math.min(this.commitIndex, this.lastApplied);
                            if (oldLastApplied != this.lastApplied) {
                                this.debugLog("!!!! Last applied value changed: %d -> %d. This must not happen", oldLastApplied, this.lastApplied);
                            }
                        }
                        this.log.push(e);
                    });

                    this.debugLog("Added %d entries to log. Log is now %d records long.", args.entries.length, this.log.length);
                }

                if (args.leaderCommit > this.commitIndex) {
                    this.commitIndex = Math.min(args.leaderCommit, this.log.length - 1);
                }

                this.applyLogEntries();

                this.rpcManager.sendReplicationResponse(senderSocket, this.currentTerm, true, this.commitIndex, this.lastApplied);
                this.debugLog("Received \"%s\" request from %s with term %d -> responded.", RPCType.APPENDENTRIES, args.senderId, args.term);
                this.resetLeaderTimeout();
                break;
            }
            case State.LEADER: {
                // This message is sent by an older leader and is no longer relevant.
                if (!args.isResponse) {
                    this.rpcManager.sendReplicationResponse(senderSocket, this.currentTerm, false, this.commitIndex, this.lastApplied);
                    this.debugLog("Received \"%s\" request from %s with previous term %d -> refused.", RPCType.APPENDENTRIES, args.senderId, args.term);
                    break;
                }

                if (args.success) { // Leader was not rejected.
                    this.matchIndex.set(args.senderId, this.lastSent.get(args.senderId));
                    this.nextIndex.set(args.senderId, this.lastSent.get(args.senderId) + 1);
                    this.nodeIdToMessageNum.set(args.senderId, this.nodeIdToMessageNum.get(args.senderId) + 1);

                    let prevLogIndex = this.nextIndex.get(args.senderId) - 1;
                    let prevLogTerm = prevLogIndex >= 0 ? this.log[prevLogIndex].term : null;

                    let sortedIndexes = [...this.matchIndex.values()].sort();
                    let oldCommitIndex = this.commitIndex;
                    this.commitIndex = sortedIndexes[Math.floor(this.clusterSize / 2)];
                    if (this.commitIndex != oldCommitIndex) {
                        this.debugLog("Set commit index to %d", this.commitIndex);
                    }

                    // Sends missing entries to the node.
                    let missingEntries = this.log.slice(this.nextIndex.get(args.senderId));
                    if (missingEntries.length > 0) {
                        this.rpcManager.sendReplicationTo(senderSocket, this.nodeIdToMessageNum.get(args.senderId), this.currentTerm, prevLogIndex, prevLogTerm, missingEntries, this.commitIndex);
                        this.debugLog("Received successful \"%s\" response from %s -> sending missing entries: %s.", RPCType.APPENDENTRIES, args.senderId, JSON.stringify({
                            currentTerm: this.currentTerm,
                            prevLogIndex: prevLogIndex,
                            prevLogTerm: prevLogTerm,
                            missingEntries: missingEntries,
                            commitIndex: this.commitIndex
                        }));
                        this.lastSent.set(args.senderId, this.log.length - 1);
                        this.resetHeartbeatTimeout(args.senderId);
                    } else {
                        this.debugLog("Received successful \"%s\" response from %s -> ignored (ok).", RPCType.APPENDENTRIES, args.senderId);
                    }

                    this.applyLogEntries();
                } else {    // Log conflict on client: server has to decrement nextIndex until there is no longer a log conflict.
                    this.nextIndex.set(args.senderId, this.nextIndex.get(args.senderId) - 1);   // Decrement next index and retry.
                    this.resetHeartbeatTimeout(args.senderId);
                }
                break;
            }
            case State.CANDIDATE: {
                if (args.isResponse) {
                    this.debugLog("Received \"%s\" response from %s -> ignored.", RPCType.APPENDENTRIES, args.senderId);
                    break;
                }

                this.rpcManager.sendReplicationResponse(senderSocket, this.currentTerm, false, this.commitIndex, this.lastApplied); // The message is for a previous term and it is rejected.
                this.debugLog("Received \"%s\" message from %s with outdated term %d -> refused.", RPCType.APPENDENTRIES, args.senderId, args.term);
                break;
            }
            default: {
                break;
            }
        }
    }

    /**
     * Handles incoming RequestVote RPC messages.
     * @param {RequestVoteParameters} args The parameters of the RequestVote RPC.
     */
    onRequestVoteMessage(args) {
        this.debugLog("/-----------------------------------------------------------------------------\\");
        this.debugLog("(%s): %s", RPCType.REQUESTVOTE, JSON.stringify(args));
        this.debugLog("\\-----------------------------------------------------------------------------/");

        let senderSocket = this.sockets.get(args.senderId);
        if (args.term > this.currentTerm) {     // Contact from a more recent candidate.
            switch (this.state) {
                case State.LEADER: {            // Stops waiting for heartbeat timeout because it's no longer the leader.
                    this.stopHeartbeatTimeout();
                    break;
                }
                case State.CANDIDATE: {         // Stops waiting for heartbeat and election timeout because it's no longer a candidate.
                    this.stopHeartbeatTimeout();
                    this.stopElectionTimeout();
                    break;
                }
                default:
                    break;
            }
            this.state = State.FOLLOWER;
            this.votedFor = null;
            this.currentLeaderId = null;
            this.currentTerm = args.term;
            this.lastMessageNum = -1;
            this.resetLeaderTimeout();
            this.webServerManager.disconnectSockets();

            this.debugLog("New election detected. Changing to %s state...", State.FOLLOWER);
        }

        switch (this.state) {
            case State.FOLLOWER: {
                if (args.isResponse) {
                    this.debugLog("Received \"%s\" response from %s -> ignore.", RPCType.REQUESTVOTE, args.senderId);
                    break;
                }

                if (this.votedFor == null && (this.log.length < args.lastLogIndex + 1 || this.log[args.lastLogIndex]?.term == args.lastLogTerm)) {
                    this.votedFor = args.senderId;
                    this.rpcManager.sendVote(senderSocket, this.currentTerm, true);
                    this.debugLog("Received \"%s\" request from %s -> cast vote.", RPCType.REQUESTVOTE, args.senderId);
                    this.resetLeaderTimeout();
                } else {
                    this.rpcManager.sendVote(senderSocket, this.currentTerm, false);
                    this.debugLog("Received \"%s\" request from %s -> refuse vote.", RPCType.REQUESTVOTE, args.senderId);
                }
                break;
            }
            case State.LEADER: {
                if (args.isResponse) {
                    this.debugLog("Received \"%s\" response from follower %s -> ignore.", RPCType.REQUESTVOTE, args.senderId)
                } else {
                    this.rpcManager.sendVote(senderSocket, this.currentTerm, false);
                    this.debugLog("Received \"%s\" request from loser candidate %s -> refuse vote.", RPCType.REQUESTVOTE, args.senderId);
                }
                break;
            }
            case State.CANDIDATE: {
                if (args.isResponse) {
                    this.stopHeartbeatTimeout(args.senderId);
                    if (args.voteGranted) {
                        this.debugLog("Received vote confirmation from %s. Votes obtained so far: %d.", args.senderId, this.votesGathered + 1);
                        if (++this.votesGathered > Math.floor(this.clusterSize / 2)) {
                            this.debugLog("Majority obtained -> changing state to leader and notifying other nodes.");
                            this.state = State.LEADER;
                            
                            this.nodeIdToMessageNum.forEach((_, id) => {
                                this.nodeIdToMessageNum.set(id, 0);
                            })

                            this.sockets.forEach((_, nodeId) => {
                                this.matchIndex.set(nodeId, -1);
                                this.nextIndex.set(nodeId, this.log.length);
                                this.lastSent.set(nodeId, this.log.length - 1);
                            });

                            this.rpcManager.sendReplication(0, this.currentTerm, this.log.length - 1, (this.log.at(-1) != null ? this.log.at(-1).term : null), [], this.commitIndex);

                            this.debugLog("Sending new heartbeat : %s", JSON.stringify({
                                messageNum: 0, 
                                currentTerm: this.currentTerm,
                                prevLogIndex: this.log.length - 1,
                                prevLogTerm: (this.log.at(-1) != null ? this.log.at(-1).term : null),
                                missingEntries: [],
                                commitIndex: this.commitIndex
                            }));

                            this.resetHeartbeatTimeout();
                            this.stopElectionTimeout();
                        }
                    } else {
                        this.debugLog("Received vote refusal from %s.", args.senderId);
                    }
                } else {
                    this.rpcManager.sendVote(senderSocket, this.currentTerm, false);
                    this.debugLog("Received \"%s\" request from other candidate %s -> refuse vote.", RPCType.REQUESTVOTE, args.senderId);
                }
                break;
            }
            default:
                break;
        }
    }

    /**
     * Handles incoming Snapshot RPC messages.
     * @param {SnapshotParameters} args The parameters of the Snapshot RPC.
     */
    onSnapshotMessage(args) {
        return; // Not implemented.
    }

    startNewElection() {
        this.leaderTimeout = null; // Timeout has expired.

        this.state = State.CANDIDATE;
        this.currentTerm++;
        this.currentLeaderId = null;
        this.votesGathered = 1;
        this.rpcManager.sendElectionNotice(this.currentTerm, this.log.length - 1, this.log.at(-1) != null ? this.log.at(-1).term : null);
        this.stopLeaderTimeout();       // Disables leader timeout.
        this.resetElectionTimeout();    // Set a timeout in case the election doesn't end.
        this.resetHeartbeatTimeout();   // Set a timeout in case other nodes do not respond.
    }

    /**
     * Set a timeout for communications from the leader.
     * In case the timeout expires, starts a new election as a candidate.
     */
    waitForLeaderTimeout() {
        let extractedInterval = this.minLeaderTimeout + Math.random() * (this.maxLeaderTimeout - this.minLeaderTimeout);
        let node = this;
        this.leaderTimeout = setTimeout(() => {
            node.debugLog("Leader timeout expired! Starting new election...");
            node.startNewElection();
        }, extractedInterval);
    }

    /**
     * Set a timeout for the current election.
     * In case the timeout expires, starts a new election as a candidate.
     */
    waitForElectionTimeout() {
        let extractedInterval = this.minElectionTimeout + Math.random() * (this.maxElectionTimeout - this.minElectionTimeout);
        let node = this;
        this.electionTimeout = setTimeout(() => {
            node.debugLog("Election timeout expired! Starting new election...");
            node.startNewElection();
        }, extractedInterval)
    }

    /**
     * Set a timeout to wait for any heartbeat.
     * In case the timeout expires, sends another heartbeat of type depending on the current state.
     * @param {Number} matchIndex Index of highest log entry known to be replicated on each follower node.
     * @param {String | null} nodeId The node to which we must send the heartbeat when the timeout expires. If null, the heartbeat is sent to all other nodes.
     */
    waitForHeartbeatTimeout(nodeId = null) {
        let thisNode = this;
        let sendHeartbeat = null;

        if (thisNode.state === State.CANDIDATE) {  // The message sent is a vote request.
            sendHeartbeat = (nodeId) => {
                thisNode.rpcManager.sendElectionNoticeTo(thisNode.sockets.get(nodeId), thisNode.currentTerm, thisNode.id, thisNode.log.length - 1, thisNode.log.at(-1) != null ? thisNode.log.at(-1).term : null);
                thisNode.debugLog("Sending new election heartbeat to node %s", nodeId);
                thisNode.resetHeartbeatTimeout(nodeId);
            };
        } else if (thisNode.state === State.LEADER) {    // The message sent is a replication request.
            sendHeartbeat = (nodeId) => {
                let missingEntries = thisNode.log.slice(thisNode.nextIndex.get(nodeId));
                let prevLogIndex = thisNode.nextIndex.get(nodeId) - 1;
                let prevLogTerm = prevLogIndex >= 0 ? thisNode.log[prevLogIndex].term : null;

                thisNode.rpcManager.sendReplicationTo(thisNode.sockets.get(nodeId), this.nodeIdToMessageNum.get(nodeId), thisNode.currentTerm, prevLogIndex, prevLogTerm, missingEntries, thisNode.commitIndex);
                thisNode.debugLog("Sending new heartbeat to node %s : %s", nodeId, JSON.stringify({
                    currentTerm: thisNode.currentTerm,
                    prevLogIndex: prevLogIndex,
                    prevLogTerm: prevLogTerm,
                    missingEntries: missingEntries,
                    commitIndex: thisNode.commitIndex
                }));
                thisNode.lastSent.set(nodeId, thisNode.log.length - 1);
                thisNode.resetHeartbeatTimeout(nodeId);
            };
        } else { // Illegal state.
            throw new Error("Cannot send heartbeat when in state " + Object.entries(State).find(e => e[1] === thisNode.state).at(0));
        }

        if (nodeId != null) { // Sends an heartbeat to a specified node.
            thisNode.heartbeatTimeouts.set(nodeId, setTimeout(() => sendHeartbeat(nodeId), thisNode.heartbeatTimeout));
        } else { // Sends an heartbeat to all other nodes.
            thisNode.otherNodes.forEach((nodeId, _) => {
                thisNode.heartbeatTimeouts.set(nodeId, setTimeout(() => sendHeartbeat(nodeId), thisNode.heartbeatTimeout));
            });
        }
    }

    /**
    * Resets the leader timeout by stopping the current timeout and initiating a new one.
    */
    resetLeaderTimeout() {
        this.stopLeaderTimeout();
        this.waitForLeaderTimeout();
    }

    /**
     * Resets the election timeout by stopping the current timeout and initiating a new one.
     */
    resetElectionTimeout() {
        this.stopElectionTimeout();
        this.waitForElectionTimeout();
    }

    /**
     * Resets the heartbeat timeout for a specific node or all nodes.
     * @param {String | null} nodeId The ID of the node for which to reset the heartbeat timeout.
     */
    resetHeartbeatTimeout(nodeId = null) {
        this.stopHeartbeatTimeout(nodeId);
        this.waitForHeartbeatTimeout(nodeId);
    }

    /**
     * Stops the leader timeout, preventing a new election from starting.
     */
    stopLeaderTimeout() {
        clearTimeout(this.leaderTimeout);
        this.leaderTimeout = null;
    }

    /**
     * Stops the election timeout, preventing a new election from starting.
    */
    stopElectionTimeout() {
        clearTimeout(this.electionTimeout);
        this.electionTimeout = null;
    }

    /**
     * Stops the heartbeat timeout for a specific node or all nodes.
     * @param {String | null} nodeId - The ID of the node for which to stop the heartbeat timeout. If null, stops all timeouts.
    */
    stopHeartbeatTimeout(nodeId = null) {
        if (nodeId != null) {
            clearTimeout(this.heartbeatTimeouts.get(nodeId));
            this.heartbeatTimeouts.delete(nodeId);
        } else {
            this.sockets.forEach((_, id) => {
                clearTimeout(this.heartbeatTimeouts.get(id));
            });
            this.heartbeatTimeouts.clear();
        }
    }

    /**
     * Debug log utility method.
     * @param {string} message The message to log in debug mode.
     */
    debugLog(message, ...optionalParams) {
        if (this.debug) {
            console.log("(" + new Date().toLocaleString().slice(-8) + ") [" + this.id + " (" + this.state + ")]: " + message, ...optionalParams);
        }
    }
}