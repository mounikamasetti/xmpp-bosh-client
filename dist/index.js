"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var events = __importStar(require("events"));
var ltx = __importStar(require("ltx"));
var url = __importStar(require("url"));
var local_utils_1 = require("./src/local-utils");
var NS_CLIENT = "jabber:client";
var NS_XMPP_SASL = "urn:ietf:params:xml:ns:xmpp-sasl";
var NS_XMPP_BIND = "urn:ietf:params:xml:ns:xmpp-bind";
var NS_XMPP_SESSION = "urn:ietf:params:xml:ns:xmpp-session";
var NS_DEF = "http://jabber.org/protocol/httpbind";
var NS_STREAM = "http://etherx.jabber.org/streams";
var STATE_FIRST = 0;
var STATE_PREAUTH = 1;
var STATE_AUTH = 2;
var STATE_AUTHED = 3;
var STATE_BIND = 4;
var STATE_SESSION = 5;
var STATE_ONLINE = 6;
var STATE_TERM = 7;
var STATE_OVER = 8;
var BoshJSClient = (function (_super) {
    __extends(BoshJSClient, _super);
    function BoshJSClient(jid, password, bosh, route) {
        var _this = _super.call(this) || this;
        _this.jid = jid;
        _this.password = password;
        _this.bosh = bosh;
        _this.route = route;
        _this.sessionAttributes = null;
        _this.chold = 0;
        _this.hasNextTick = false;
        _this.state = STATE_FIRST;
        _this.pending = [];
        _this.sessionSupport = false;
        console.log("Constructing BoshJSClient");
        _this.sessionAttributes = {
            rid: Math.round(Math.random() * 10000),
            jid: local_utils_1.jidParse(_this.jid),
            password: _this.password,
        };
        var u = url.parse(bosh);
        _this.options = {
            host: u.hostname,
            port: u.port,
            path: u.pathname,
            method: "POST",
            agent: false,
            protocol: u.protocol,
        };
        var attr = {
            "content": "text/xml; charset=utf-8",
            "to": _this.sessionAttributes.jid.domain,
            "rid": _this.sessionAttributes.rid++,
            "hold": 1,
            "wait": 60,
            "ver": "1.6",
            "xml:lang": "en",
            "xmpp:version": "1.0",
            "xmlns": NS_DEF,
            "xmlns:xmpp": "urn:xmpp:xbosh",
            "route": null,
        };
        if (route) {
            attr.route = route;
        }
        var body = new ltx.Element("body", attr);
        _this.sendHttp(body.toString());
        return _this;
    }
    BoshJSClient.prototype.emit = function (event) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        console.log("emitting " + event.toString());
        return _super.prototype.emit.apply(this, [event].concat(args));
    };
    BoshJSClient.prototype.sendHttp = function (body) {
        var that = this;
        this.chold++;
        local_utils_1.xmlHttpRequest(this.options, function (err, response) { that.handle(err, response); }, body);
    };
    BoshJSClient.prototype.handle = function (err, response) {
        this.chold--;
        if (err) {
            local_utils_1.logIt("ERROR", this.sessionAttributes.jid + " no response " + response);
            this.emit("error", response);
            return;
        }
        var body = null;
        try {
            body = ltx.parse(response);
        }
        catch (err) {
            this.pError("xml parsing ERROR: " + response);
            return;
        }
        var serror = body.getChild("error", NS_STREAM);
        if (serror) {
            local_utils_1.logIt("ERROR", "stream Error :  " + serror);
            this.state = STATE_TERM;
            this.emit("offline", "stream-error " + body.toString());
            return;
        }
        if (body.attrs.type && body.attrs.type === "terminate") {
            if (this.state !== STATE_TERM) {
                local_utils_1.logIt("INFO", "Session terminated By the Server " + body);
                this.state = STATE_TERM;
                this.emit("offline", "Session termination by server " + body.toString());
                return;
            }
        }
        if (this.state === STATE_FIRST) {
            this.state = STATE_PREAUTH;
            for (var i in body.attrs) {
                this.sessionAttributes[i] = body.attrs[i];
            }
        }
        if (this.state === STATE_PREAUTH) {
            var features = body.getChild("features", NS_STREAM);
            if (features) {
                this.startSasl(features);
                this.state = STATE_AUTH;
            }
            else {
                this.sendXml();
            }
            return;
        }
        if (this.state === STATE_AUTH) {
            local_utils_1.logIt("DEBUG", "STATE_AUTH with body: " +
                body.getChild("success", "urn:ietf:params:xml:ns:xmpp-sasl") + " and NS_CLIENT: " + NS_CLIENT);
            var success = body.getChild("success", "urn:ietf:params:xml:ns:xmpp-sasl");
            var failure = body.getChild("failure", NS_CLIENT);
            if (success) {
                local_utils_1.logIt("DEBUG", "Authentication Success:  " + this.sessionAttributes.jid);
                this.state = STATE_AUTHED;
                this.restartStream();
            }
            else if (failure) {
                this.pError("Authentication Failure: " + this.sessionAttributes.jid + body);
            }
            else {
                this.sendXml();
            }
            return;
        }
        if (this.state === STATE_AUTHED) {
            var features = body.getChild("features", NS_STREAM);
            if (features) {
                if (features.getChild("session", NS_XMPP_SESSION)) {
                    this.sessionSupport = true;
                }
                else {
                    this.sessionSupport = false;
                }
                if (features.getChild("bind", NS_XMPP_BIND)) {
                    this.state = STATE_BIND;
                    this.bindResource(this.sessionAttributes.jid.resource);
                }
                else {
                    this.pError("Resource binding not supported");
                }
            }
            else {
                this.sendXml();
            }
            return;
        }
        if (this.state === STATE_BIND) {
            var iq = body.getChild("iq", NS_CLIENT);
            if (iq) {
                if (iq.attrs.id === "bind_1" && iq.attrs.type === "result") {
                    var cjid = iq.getChild("bind", NS_XMPP_BIND).getChild("jid", NS_XMPP_BIND).getText();
                    this.sessionAttributes.jid.resource = cjid.substr(cjid.indexOf("/") + 1);
                    if (this.sessionSupport) {
                        var iqi = new ltx.Element("iq", { to: this.sessionAttributes.jid.domain, type: "set", id: "sess_1" });
                        iqi.c("session", { xmlns: NS_XMPP_SESSION });
                        this.sendXml(iqi);
                        this.state = STATE_SESSION;
                    }
                    else {
                        this.getOnline();
                    }
                }
                else {
                    this.pError("iq stanza error resource binding :  " + iq);
                }
            }
            else {
                this.sendXml();
            }
            return;
        }
        if (this.state === STATE_SESSION) {
            var iq = body.getChild("iq");
            if (iq) {
                if (iq.attrs.id === "sess_1" && iq.attrs.type === "result") {
                    this.getOnline();
                }
                else {
                    this.pError("iq stanza error session establishment : " + iq);
                }
            }
            else {
                this.sendXml();
            }
            return;
        }
        if (this.state === STATE_ONLINE) {
            this.handleOnline(body);
            return;
        }
        if (this.state === STATE_TERM) {
            local_utils_1.logIt("INFO", "client terminating : " + this.sessionAttributes.jid);
            this.state = STATE_OVER;
            return;
        }
        if (this.state === STATE_OVER) {
            return;
        }
    };
    BoshJSClient.prototype.pError = function (ss) {
        local_utils_1.logIt("ERROR", ss);
        this.emit("error", ss);
        this.terminate();
        return;
    };
    BoshJSClient.prototype.getOnline = function () {
        local_utils_1.logIt("INFO", "Session Created :  " + this.sessionAttributes.jid);
        this.state = STATE_ONLINE;
        this.emit("online");
        this.sendPending();
        return;
    };
    BoshJSClient.prototype.handleOnline = function (body) {
        var _this = this;
        body.children.forEach(function (ltxe) {
            _this.emit("stanza", ltxe);
        });
        this.sendPending();
        return;
    };
    BoshJSClient.prototype.startSasl = function (features) {
        var mechanisms = features.getChild("mechanisms", NS_XMPP_SASL);
        if (!mechanisms) {
            this.pError("No features-startSasl");
            return;
        }
        for (var i = 0; i < mechanisms.children.length; i++) {
            if (mechanisms.children[i].getText() === "PLAIN") {
                var e = new ltx.Element("auth", { xmlns: NS_XMPP_SASL, mechanism: "PLAIN" });
                e.t(this.getPlain());
                this.sendXml(e);
                return;
            }
        }
        this.pError("Plain SASL authentication unavailable!!!");
    };
    BoshJSClient.prototype.getPlain = function () {
        var authzid = this.sessionAttributes.jid.username + "@" + this.sessionAttributes.jid.domain;
        var authcid = this.sessionAttributes.jid.username;
        var password = this.sessionAttributes.password;
        return local_utils_1.encode64(authzid + "\u0000" + authcid + "\u0000" + password);
    };
    BoshJSClient.prototype.terminate = function () {
        var body = new ltx.Element("body", {
            sid: this.sessionAttributes.sid,
            rid: this.sessionAttributes.rid++,
            type: "terminate", xmlns: NS_DEF,
        });
        body.c("presence", { type: "unavailable", xmlns: NS_CLIENT });
        this.sendHttp(body.toString());
        this.state = STATE_TERM;
    };
    BoshJSClient.prototype.restartStream = function () {
        var attr = {
            "rid": this.sessionAttributes.rid++,
            "sid": this.sessionAttributes.sid,
            "xmpp:restart": "true",
            "to": this.sessionAttributes.from,
            "xml:lang": "en",
            "xmlns": NS_DEF,
            "xmlns:xmpp": "urn:xmpp:xbosh",
        };
        var body = new ltx.Element("body", attr);
        this.sendHttp(body.toString());
    };
    BoshJSClient.prototype.bindResource = function (resName) {
        var resource = new ltx.Element("resource");
        resource.t(resName);
        var bind = new ltx.Element("bind", { xmlns: NS_XMPP_BIND });
        bind.cnode(resource);
        var iq = new ltx.Element("iq", { id: "bind_1", type: "set", xmlns: NS_CLIENT });
        iq.cnode(bind);
        this.sendXml(iq);
    };
    BoshJSClient.prototype.sendXml = function (ltxe) {
        var body = new ltx.Element("body", {
            sid: this.sessionAttributes.sid,
            rid: this.sessionAttributes.rid++,
            xmlns: NS_DEF,
            stream: this.sessionAttributes.stream,
        });
        if (ltxe) {
            body.cnode(ltxe);
        }
        this.sendHttp(body.toString());
    };
    BoshJSClient.prototype.sendMessage = function (to, mbody, type) {
        var message = new ltx.Element("message", {
            "to": to,
            "from": this.sessionAttributes.jid.toString(),
            "type": type || "chat",
            "xml:lang": "en",
        });
        var body = new ltx.Element("body").t(mbody);
        message.cnode(body);
        this.send(message);
    };
    BoshJSClient.prototype.send = function (ltxe) {
        ltxe = ltxe.tree();
        if (this.state !== STATE_ONLINE) {
            this.emit("error", "can send something only when u are ONLINE!!!");
            return;
        }
        if (ltxe) {
            this.pending.push(ltxe);
        }
        if (!this.hasNextTick) {
            this.hasNextTick = true;
            var that_1 = this;
            process.nextTick(function () {
                if (that_1.hasNextTick && that_1.state === STATE_ONLINE) {
                    that_1.sendPending();
                }
            });
        }
    };
    BoshJSClient.prototype.sendPending = function () {
        if (this.pending.length > 0 || this.chold < 1) {
            var body = new ltx.Element("body", {
                sid: this.sessionAttributes.sid,
                rid: this.sessionAttributes.rid++,
                xmlns: NS_DEF,
                stream: this.sessionAttributes.stream,
            });
            while (this.pending.length > 0) {
                body.cnode(this.pending.shift());
            }
            this.sendHttp(body.toString());
            this.hasNextTick = false;
        }
    };
    BoshJSClient.prototype.disconnect = function () {
        this.sendPending();
        this.terminate();
        this.emit("offline", "session termination by user");
        return;
    };
    return BoshJSClient;
}(events.EventEmitter));
exports.BoshJSClient = BoshJSClient;
exports.Element = ltx.Element;
exports.$build = function (xname, attrib) {
    return new ltx.Element(xname, attrib);
};
exports.$msg = function (attrib) {
    return new ltx.Element("message", attrib);
};
exports.$iq = function (attrib) {
    return new ltx.Element("iq", attrib);
};
exports.$pres = function (attrib) {
    return new ltx.Element("presence", attrib);
};
var local_utils_2 = require("./src/local-utils");
exports.setLogLevel = local_utils_2.setLogLevel;
//# sourceMappingURL=index.js.map