const multihashes = require('multihashes');
const crypto = require('crypto');
const crypto2 = require('libp2p-crypto');
const BufferShift = require("buffershift");
const bs58 = require('bs58');
const protobuf = require('protobufjs');
const nacl = require('tweetnacl');
const sha256 = require('js-sha256');
const Base64 = require('js-base64').Base64;
const ed2curve = require('ed2curve');
const bip39 = require('bip39');
const request = require("request");
const PeerId = require('peer-id');
const IPFS = require('ipfs');
const PeerInfo = require('peer-info');
const pull = require('pull-stream');
const Pushable = require('pull-pushable');
const p = Pushable();

var identity_key = "";
var relay_server = "wss://webchat.ob1.io:8080";
var mnemonic = ""; // You can use this from your other OpenBazaar install backup or leave empty
var subscription_key = "";
var jsonDescriptor = require("./message.json");
var ephem_keypair = "";
var my_peer_id = "";
var root = protobuf.Root.fromJSON(jsonDescriptor);

window.root = root;

var ws = "";

const oldLog = console.log;

console.log = (...args) => {
  if (args[0] === 'hero') return oldLog(...args.slice(1));
}

const log = (...args) => {
  console.log('hero', ...args);
}

let node;

const init = (name = '', cb) => {
  const options = {
    EXPERIMENTAL: {
      pubsub: true
    },
    relay: {
      "enabled": true,
      "hop": {
        "enabled": true
      }
    },
    repo: `./ipfs/ipfs-node${name ? `-${name}` : ''}`,
  };

  node = new IPFS(options);

  node.on('ready', () => {
    document.getElementById('peerid').innerHTML = node._peerInfo.id._idB58String;

    my_peer_id = node._peerInfo.id._idB58String;

    peer = "/dns4/webchat.ob1.io/tcp/9999/wss/ipfs/QmVc37Xishzc8R3ZXn1p4Mm27nkSWhGSVdRr9Zi3NPRq8V"; // Webchat Relay Circuit Hop
    
    node.swarm.connect(peer, (err) => {
      if (err) {
        return console.error(err)
      }

      log(`Connected to curcuit relay peer: `, peer);

      if (typeof cb === 'function') cb();
    });

    // handle incoming messages
    // node._libp2pNode.handle('dabears/1', (protocol, conn) => {
    //   log('pro con');
    //   window.pro = protocol;
    //   window.con = conn;
    //   pull(conn, conn);
    // });

    // handle incoming messages
    node._libp2pNode.handle('dabears/1', (protocol, conn) => {
      const Message = root.lookupType('Message');
      const Chat = root.lookupType('Chat');

      pull(
        conn,
        // pull.map((data) => {
        //   return data.toString('utf8').replace('\n', '')
        // }),
        pull.collect((...args) => {
          const [err, data] = args;
          if (err) { throw err };
          log('received echo:', data.toString());
          window.echo = args;

          const decodedMsg = Message.decode(data[0]);
          log('decoded message aroo');
          window.aroo = decodedMsg;

          const decodedChatMsg = Chat.decode(decodedMsg.payload.value);
          log('decode chat message pickle');
          window.pickle = decodedChatMsg;
        }),
      );
    });
  });
};

function getChatPayload(message) {
  var subject = ""; // Empty subject for chat message
  var timestamp = new Date();
  var timestamp_secs = Math.floor(timestamp / 1000);
  const combinationString = subject + "!" + timestamp.toISOString();

  var idBytes = crypto.createHash('sha256').update(combinationString).digest();
  var idBytesArray = new Uint8Array(idBytes);
  var idBytesBuffer =  new Buffer(idBytesArray.buffer);
  var encoded = multihashes.encode(idBytesBuffer,0x12);

  var payload = {
    messageId: multihashes.toB58String(encoded),
    subject: "",
    message: message || "TEST",
    timestamp: { seconds: timestamp_secs, nanos: 0},
    flag: 0
  };

  return payload;
}

const sendMessageForm = document.getElementById('sendMessageForm');

sendMessageForm.addEventListener(
  'submit',
  (e, ...args) => {
    e.preventDefault();

    const peerID = sendMessageForm.peerID.value;
    const message = sendMessageForm.message.value;

    if (!node) init(sendMessageForm.name.value,
      () => sendMessage(peerID, message));
    else sendMessage(peerID, message);
  },
  false
);

/***************
/* Call these methods from the browser
****************/

window.generatePeerID = (cb) => {
  if(!mnemonic) {
    log("No mnemonic set...");
    mnemonic = bip39.generateMnemonic();
    log("Generated mnemonic:", mnemonic);
  }
  var bip39seed = bip39.mnemonicToSeed(mnemonic, 'Secret Passphrase');
  var hmac = sha256.hmac.create("OpenBazaar seed");
  hmac.update(bip39seed);
  var seed = new Uint8Array(hmac.array());
  crypto2.keys.generateKeyPairFromSeed('ed25519', seed, (err, keypair)=>{
    var peerid = PeerId.createFromPubKey(crypto2.keys.marshalPublicKey(keypair.public), (err, key)=>{
      log("Peer ID:", key._idB58String);
      my_peer_id = key._idB58String;
      cb({
        "mnemonic": mnemonic,
        "peerid": key._idB58String
      });
    });

  });
}

window.sendMessage = (peerid, message) => {

  peer = "/p2p-circuit/ipfs/" + peerid;

  node.swarm.connect(peer, (err) => {
    if (err) {
      return console.error("Error", err)
    }
    log("Connected to peer:", peer);

    // node.swarm.peers((err, peerInfos) => {
    //   if (err) {
    //     throw err
    //   }
    //   log("PEER INFO", peerInfos)
    // });


    // Send message to other node
    node._libp2pNode.dialProtocol(peer, 'dabears/1', (err, conn) => {
      if (err) { throw err }

      log('Web Node to Desktop Node on: ', conn)

      var Chat = root.lookupType("Chat");
      var payload = getChatPayload(message);
      log("Chat Payload:", payload);

      if (Chat.verify(payload)) {
        log("Problem verifying Chat protobuf payload");
      }
      var chatmessage = Chat.create(payload);
      var serializedChat = Chat.encode(chatmessage).finish();

      var Message = root.lookupType("Message");
      var message_payload = {
        messageType: 1,
        payload: {
          type_url: "type.googleapis.com/Chat",
          value: serializedChat
        }
      };
      log("Message Payload filly:", message_payload);
      window.filly = message_payload;

      if (Message.verify(message_payload)) {
        log("Problem verifying Message protobuf payload");
      }
      var messageMessage = Message.create(message_payload);
      var serializedMessage = Message.encode(messageMessage).finish();
      log('encoded payload: ', serializedMessage);

      function sink(read) {
        // console.log(this)
        read(null, function next (err, data) {
          if(err) return console.log(err)
          log('MY DATA', data)
          read(null, next)
        })
      }

      pull(
        pull.once(serializedMessage),
        conn,
        pull.collect((err, data) => {
          if (err) { throw err }
          // log('received echo:', data.toString())
        }),
      )
    })
  })

}
