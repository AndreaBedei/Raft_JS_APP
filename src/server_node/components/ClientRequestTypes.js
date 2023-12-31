export class NewUserRequest {
    /**
     * Represents a request to create a new user.
     * @param {String} username The name of the new user.
     * @param {String} password The password of the new user.
     */
    constructor(username, password) {
        /** @type {String} */
        this.username = username;
        /** @type {String} */
        this.password = password;
    }
}

export class NewBidRequest {
    /**
     * Represents a request to place a new bid in an auction.
     * @param {String} username The name of the user making the bid.
     * @param {Number} auctionId The id of the auction the bid is being made on.
     * @param {Number} bidValue The value of the bid.
     */
    constructor(username, auctionId, bidValue) {
        /** @type {String} */
        this.username = username;
        /** @type {String} */
        this.auctionId = auctionId;
        /** @type {Number} */
        this.bidValue = bidValue;
    }
}

export class GetAuctionInfoRequest {
    /**
     * Represents a request to retrieve information about an auction.
     * @param {Number} auctionId The id of the auction.
     */
    constructor(auctionId) {
        /** @type {Number} */
        this.auctionId = auctionId;
    }
}

export class NewAuctionRequest {
    /**
     * Represents a request to create a new auction.
     * @param {String} username The name of the user creating the auction.
     * @param {Date} startDate The date of the start of the auction.
     * @param {String} objName The name of the object up for auction.
     * @param {?String} objDesc A description of the object being auctioned.
     * @param {Number} startPrice The starting price of the auction.
     */
    constructor(username, startDate, objName, objDesc, startPrice) {
        /** @type {String} */
        this.username = username;
        /** @type {String} */
        this.startDate = startDate.toISOString();
        /** @type {String} */
        this.objName = objName;
        /** @type {?String} */
        this.objDesc = objDesc;
        /** @type {Number} */
        this.startPrice = startPrice;
    }
}

export class LoginRequest {
    /**
     * Represents a request to authenticate a user.
     * @param {String} username The name of the user.
     * @param {String} password The password of the user.
     */
    constructor(username, password) {
        /** @type {String} */
        this.username = username;
        /** @type {String} */
        this.password = password;
    }
}

export class CloseAuctionRequest {
    /**
     * Represents a request to close an auction.
     * @param {Number} auctionId The id of the auction being closed.
     * @param {Date} closingDate The date of end of the auction.
     */
    constructor(auctionId, closingDate) {
        /** @type {Number} */
        this.auctionId = auctionId;
        /** @type {String} */
        this.closingDate = closingDate.toISOString();
    }
}

export class GetNewBidsRequest {
    /**
     * Represents a request to retrieve new bids in an auction.
     * @param {Number} auctionId The id of the auction.
     * @param {Number} lastBidId The id of the last bid before the new ones.
     */
    constructor(auctionId, lastBidId) {
        /** @type {Number} */
        this.auctionId = auctionId;
        /** @type {Number} */
        this.lastBidId = lastBidId;
    }
}

export class GetUserAuctionsRequest {
    /**
     * Represents a request to retrieve auctions associated with a user.
     * @param {String} username The name of the user whose auctions we want to load.
     */
    constructor(username) {
        /** @type {String} */
        this.username = username;
    }
}

export class GetUserParticipationsRequest {
    /**
     * Represents a request to retrieve auction participations associated with a user.
     * @param {String} username The name of the user whose participations we want to load.
     */
    constructor(username) {
        /** @type {String} */
        this.username = username;
    }
}

export class GetLastBidsRequest {
    /**
     * Represents a request to retrieve the last bids in an auction.
     * @param {Number} auctionId The id of the auction.
     * @param {Number} numOfBids The number of bids to load.
     */
    constructor(auctionId, numOfBids) {
        /** @type {Number} */
        this.auctionId = auctionId;
        /** @type {Number} */
        this.numOfBids = numOfBids;
    }
}

export class UserExistsRequest {
    /**
     * Represents a request to verify the existence of a user.
     * @param {String} username The name of the user we want to verify exists.
     */
    constructor(username) {
        /** @type {String} */
        this.username = username;
    }
}