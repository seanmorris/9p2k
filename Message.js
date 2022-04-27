const Constants   = require('./Constants');
const NString     = require('./NString').NString;
const Qid         = require('./Qid').Qid;
const QSession    = require('./QSession').QSession;
const EventTarget = require('./EventTarget').EventTarget;
const Event       = require('./Event').Event;
const File        = require('./File').File;
const FileService = require('./FileService').FileService;

class Message
{
	blob;
	size;
	TYPE;
	type;

	static parse(blob)
	{
		const instance = new this.prototype.constructor;
		const dataView = new DataView(new Uint8Array([...blob]).buffer);

		instance.view  = dataView;

		instance.size  = dataView.getUint32(0, true);
		instance.type  = dataView.getUint8(4, true);

		for(const packetType in Constants)
		{
			if(instance.type === Constants[packetType])
			{
				instance.TYPE = packetType;
			}
		}

		instance.blob = blob;

		return instance;
	}

	encode(message){}

	toString()
	{
		return this.blob.toString();
	}
}

class RMessage extends Message
{
	tag;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.tag   = dataView.getUint16(5, true);

		return instance;
	}
}

class TMessage extends Message
{
	static responseType = RMessage;

	tag;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.tag   = dataView.getUint16(5, true);

		return instance;
	}

	response()
	{
		return this.constructor.responseType.encode(this);
	}
}

class RVersionMessage extends RMessage
{
	version;

	static encode(tMessage)
	{
		const bytes = [
			0, 0, 0, 0,
			Constants.R_VERSION,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
			... new Uint8Array(new Uint32Array([8192]).buffer),
			... NString.encode('9P2000')
		];

		bytes[0] = bytes.length;

		const instance = new this.prototype.constructor;

		instance.blob = Buffer.from(new Uint8Array(bytes));

		return instance;
	}
}

class TVersionMessage extends TMessage
{
	static responseType = RVersionMessage;

	version;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.version = String( NString.decode(blob, 11) );

		return instance;
	}

	response()
	{
		// const blob = Buffer.alloc(this.blob.length);

		// this.blob.copy(blob);

		// const dataView = new DataView(blob.buffer);

		// dataView.setUint8(4, Constants.R_VERSION, true);

		return RVersionMessage.encode(this);
	}
}

class RErrorMessage extends RMessage
{
	version;

	static encode(tMessage)
	{
		const bytes = [
			0, 0, 0, 0,
			Constants.R_ERROR,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
			... new Uint8Array(new Uint16Array([0]).buffer),
		];

		bytes[0] = bytes.length;

		const instance = new this.prototype.constructor;

		instance.blob = Buffer.from(new Uint8Array(bytes));

		return instance;
	}
}

class RAttachMessage extends RMessage
{
	static encode(tMessage)
	{
		const file = FileService.getByPath('/', true);
		const qid  = QSession.getQid(file);

		FileService.assignFid(tMessage.fid, file);

		const instance = new this.prototype.constructor;

		const attachEvent = new Event('attach', {cancelable: true, detail: {file, tMessage}});

		process.stderr.write(`\u001b[34m ATCH: ${tMessage.tag} ${tMessage.fid} ${file.path}\u001b[39m `);

		if(!MessageService.target.dispatchEvent(attachEvent))
		{
			process.stderr.write(`[ \u001b[31mSTOP\u001b[39m ]\n`);

			return RlErrorMessage.encode(tMessage);
		}

		process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);

		const bytes = [
			0, 0, 0, 0,
			Constants.R_ATTACH,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
			... qid,
		];

		bytes[0] = bytes.length;

		instance.blob = Buffer.from(new Uint8Array(bytes));
		instance.size = bytes[0];
		instance.type = Constants.R_ATTACH;
		instance.TYPE = 'R_ATTACH';
		instance.tag  = tMessage.tag;

		return instance;
	}
}

class TAttachMessage extends TMessage
{
	static responseType = RAttachMessage;

	fid;
	afid;
	aName;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid   = dataView.getUint32(7, true);
		instance.afid  = dataView.getUint32(11, true);

		instance.uName = String( NString.decode(blob, 15) );
		instance.aName = String( NString.decode(blob, 17 + instance.uName.length) );

		return instance;
	}
}

class RStatMessage extends RMessage
{
	static encode(tMessage)
	{
		const rMessage = new this.prototype.constructor;

		const file = FileService.getByFid(tMessage.fid);

		if(!file)
		{
			return RErrorMessage.encode(tMessage);
		}

		const statEvent = new Event('stat', {cancelable: true, detail: {file}});

		process.stderr.write(`\u001b[34m STAT: ${tMessage.tag} ${tMessage.fid} ${file?.path}\u001b[39m `);

		if(!MessageService.target.dispatchEvent(statEvent))
		{
			process.stderr.write(`[ \u001b[31mSTOP\u001b[39m ]\n`);

			return RErrorMessage.encode(tMessage);
			// return RlErrorMessage.encode(tMessage);
		}

		process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);

		const mode = (file.mode << 0) + (file.directory ? 0x80000000 : 0);
		const stats = [0 ,0];

		const stat = [
			... new Uint8Array(new Uint16Array([0]).buffer), // size
			... new Uint8Array(new Uint16Array([0]).buffer),                             // type
			... new Uint8Array(new Uint32Array([0]).buffer),                             // dev
			... QSession.getQid(file),                                                   // QID
			... new Uint8Array(new Uint32Array([mode]).buffer),                          // mode
			... new Uint8Array(new Uint32Array([Math.trunc(Date.now() / 1000)]).buffer), // atime
			... new Uint8Array(new Uint32Array([Math.trunc(Date.now() / 1000)]).buffer), // mtime
			... new Uint8Array(new BigUint64Array([BigInt(file.size ?? 0)]).buffer),     // length
			... NString.encode(file.root ? 'root' : file.name),                          // Name
			... NString.encode('sean'),                                                  // uid
			... NString.encode('sean'),                                                  // gid
			... NString.encode('sean'),                                                  // muid
		];

		Object.assign(stat, new Uint8Array(new Uint16Array([stat.length]).buffer));

		stats.push(...stat);

		Object.assign(stats, new Uint8Array(new Uint16Array([stats.length]).buffer));

		const bytes = [
			0, 0, 0, 0,
			Constants.R_STAT,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
			... stats
		];

		bytes[0] = bytes.length;

		rMessage.size = bytes[0];
		rMessage.blob = Buffer.from(new Uint8Array(bytes));

		rMessage.type = Constants.R_STAT;
		rMessage.TYPE = 'R_STAT';
		rMessage.tag  = tMessage.tag;

		return rMessage;
	}
}

class TStatMessage extends TMessage
{
	static responseType = RStatMessage;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid   = dataView.getUint32(7, true);

		return instance;
	}
}

class RWStatMessage extends RMessage
{
	static encode(tMessage)
	{
		const rMessage = new this.prototype.constructor;

		const bytes = [
			0, 0, 0, 0,
			Constants.R_WSTAT,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
		];

		bytes[0] = bytes.length;

		rMessage.size = bytes[0];
		rMessage.blob = Buffer.from(new Uint8Array(bytes));

		rMessage.type = Constants.R_WSTAT;
		rMessage.TYPE = 'R_WSTAT';
		rMessage.tag  = tMessage.tag;

		return rMessage;
	}
}

class TWStatMessage extends TMessage
{
	static responseType = RWStatMessage;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid   = dataView.getUint32(7, true);

		return instance;
	}
}

class RGetAttrMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;
		const file = FileService.getByFid(message.fid);

		const qid  = QSession.getQid(file);

		file.size  = file.directory ? 0 : 10;

		const mode = (file.mode << 0) + (file.directory ? 0o040000 : 0);

		const bytes   = [
			0, 0, 0, 0,
			Constants.R_GETATTR,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			... new Uint8Array(new Uint32Array([0x3FFF, 0x0]).buffer),
			... qid,
			... new Uint8Array(new Uint32Array([mode]).buffer), // mode
			... new Uint8Array(new Uint32Array([file.uid ?? 1000]).buffer), // uid
			... new Uint8Array(new Uint32Array([file.gid ?? 1000]).buffer), // gid
			... [1, 0, 0, 0, 0, 0, 0, 0],    // nlink
			... [0, 0, 0, 0, 0, 0, 0, 0],    // rdev
			... new Uint8Array(new BigUint64Array([BigInt(file.size ?? 0)]).buffer), // size
			... [0, 0x10, 0, 0, 0, 0, 0, 0], // blockSize
			... [0, 0, 0, 0, 0, 0, 0, 0],    // blocks
			... new Uint8Array(new BigUint64Array([BigInt(Math.trunc(Date.now() / 1000))]).buffer), // aTime
			... [0, 0, 0, 0, 0, 0, 0, 0], // aTimeNs
			... new Uint8Array(new BigUint64Array([BigInt(Math.trunc(Date.now() / 1000))]).buffer), // mTime
			... [0, 0, 0, 0, 0, 0, 0, 0], // mTimeNs
			... new Uint8Array(new BigUint64Array([BigInt(Math.trunc(Date.now() / 1000))]).buffer), // cTime
			... [0, 0, 0, 0, 0, 0, 0, 0], // cTimeNs
			... new Uint8Array(new BigUint64Array([BigInt(Math.trunc(Date.now() / 1000))]).buffer), // bTime
			... [0, 0, 0, 0, 0, 0, 0, 0], // bTimeNs
			... [0, 0, 0, 0, 0, 0, 0, 0],    // gen
			... [0, 0, 0, 0, 0, 0, 0, 0],    // dataversion
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_GETATTR;
		instance.TYPE = 'R_GETATTR';
		instance.tag  = message.tag;

		return instance;
	}
}

class TGetAttrMessage extends TMessage
{
	static responseType = RGetAttrMessage;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid   = dataView.getUint32(7, true);

		return instance;
	}
}

class RSetAttrMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;
		const file = FileService.getByFid(message.fid);

		const qid  = QSession.getQid(file);

		file.aTime = 0;//Math.trunc(Date.now() / 1000);
		file.size  = file.directory ? 0 : 10;

		const bytes   = [
			0, 0, 0, 0,
			Constants.R_SETATTR,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_GETATTR;
		instance.TYPE = 'R_GETATTR';
		instance.tag  = message.tag;

		return instance;
	}
}

class TSetAttrMessage extends TMessage
{
	static responseType = RSetAttrMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
 		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.valid  = dataView.getUint32(11, true);
		instance.mode   = dataView.getUint32(15, true);
		instance.uid    = dataView.getUint32(19, true);
		instance.gid    = dataView.getUint32(23, true);
		instance.size   = dataView.getBigInt64(27, true);
		instance.aTime  = dataView.getBigInt64(31, true);
		instance.aTimeN = dataView.getBigInt64(33, true);
		instance.mTime  = dataView.getBigInt64(31, true);
		instance.mTimeN = dataView.getBigInt64(33, true);

		return instance;
	}
}

class RWalkMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;
		const qid = QSession.getQid(message.file);

		const bytes   = [
			0, 0, 0, 0,
			Constants.R_WALK,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			... new Uint8Array(new Uint16Array([(message.walks ? 1 : 0)]).buffer),
			... (message.walks ? qid : [])
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_WALK;
		instance.TYPE = 'R_WALK';
		instance.tag  = message.tag;

		return instance;
	}
}

class TWalkMessage extends TMessage
{
	static responseType = RWalkMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.newFid = dataView.getUint32(11, true);
		instance.walks  = dataView.getUint16(15, true);

		if(instance.walks)
		{
			instance.wName = String( NString.decode(blob, 17) );
		}

		return instance;
	}

	response()
	{
		if(String(this.wName).match(/^\.+\/*$/) || String(this.wName).match(/\//))
		{
			return RErrorMessage.encode(tMessage);
			// return RlErrorMessage.encode(this);
		}

		const parent = this.file = FileService.getByFid(this.fid);
		const wName  = this.wName ?? '';

		const walkEvent = new Event('walk', {cancelable: true, detail: {
			directory: parent.path
			, file:    wName
		}});

		process.stderr.write(`\u001b[34m WALK: ${this.tag} ${this.fid} ${parent.path} ${wName}\u001b[39m `);

		if(!MessageService.target.dispatchEvent(walkEvent))
		{
			process.stderr.write(`[ \u001b[31mSTOP\u001b[39m ]\n`);

			return RErrorMessage.encode(tMessage);
			// return RlErrorMessage.encode(this);
		}

		process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);

		if(!this.walks)
		{
			if(this.file)
			{
				FileService.assignFid(this.newFid, this.file);
			}

			return RWalkMessage.encode(this);
		}

		if(walkEvent.getOverride(parent.canWalkTo(wName)))
		{
			const fullPath = parent.path === '/'
				? '/' + wName
				: '/' + parent.fullPath() + '/' + wName;

			const subFile = this.file = FileService.getByPath(fullPath);

			FileService.assignFid(this.newFid, this.file);

			return super.response()
		}

		return RWalkMessage.encode(this);

		// const response = RlErrorMessage.encode(this);

		// return response;
	}
}

class RlOpenMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;

		const file = FileService.getByFid(message.fid);
		const qid  = QSession.getQid(file);

		const bytes = [
			0, 0, 0, 0,
			Constants.R_LOPEN,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			... qid,
			0, 0, 0, 0,
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_LOPEN;
		instance.TYPE = 'R_LOPEN';
		instance.tag  = message.tag;

		return instance;
	}
}

class TlOpenMessage extends TMessage
{
	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid   = dataView.getUint32(7, true);
		instance.mode  = blob.slice(11, 11 + 4);

		return instance;
	}

	response()
	{
		const file = FileService.getByFid(this.fid);

		if(file)
		{
			const response = RlOpenMessage.encode(this);

			return response;
		}

		return super.response();
	}
}

class RReadDirMessage extends RMessage
{
	static encode(tMessage)
	{
		const instance = new this.prototype.constructor;

		const entries = [0, 0, 0, 0];

		const parent = FileService.getByFid(tMessage.fid);

		if(!tMessage.offset)
		{
			let index = 0;

			const children = parent.getChildren();

			const listEvent = new Event('list', {cancelable: true, detail: {
				directory:  parent.path
				, children: children
				, offset:   tMessage.offset
				, count:    tMessage.count
				, fid:      tMessage.fid
			}});

			process.stderr.write(`\u001b[36m LIST: ${tMessage.tag} ${tMessage.fid} ${parent.path}\u001b[39m `);

			if(!MessageService.target.dispatchEvent(listEvent))
			{
				process.stderr.write(`[ \u001b[31mSTOP\u001b[39m ]\n`);

				return RlErrorMessage.encode(tMessage);
			}

			process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);

			for(const file of listEvent.getOverride(children))
			{
				const name = file.name;

				const qid   = QSession.getQid(file);
				const entry = [
					...qid,
					0x04,
					... new Uint8Array(new BigUint64Array([BigInt(++index)]).buffer),
					... NString.encode(name)
				];

				entries.push(...entry);
			}

			Object.assign(entries, new Uint8Array(new Uint32Array([entries.length]).buffer));
		}

		const bytes = [
			0, 0, 0, 0,
			Constants.R_READDIR,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
			... entries
		];

		instance.size = bytes.length;

		Object.assign(bytes, new Uint8Array(new Uint32Array([bytes.length]).buffer));

		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_READDIR;
		instance.TYPE = 'R_READDIR';
		instance.tag  = tMessage.tag;

		return instance;
	}
}

class TReadDirMessage extends TMessage
{
	static responseType = RReadDirMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.offset = dataView.getBigInt64(9, true);
		instance.count  = dataView.getUint32(13, true);

		return instance;
	}
}

class RStatFsMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;

		const bytes = [
			0, 0, 0, 0,
			Constants.R_STATFS,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			0x97, 0x19, 0x02, 0x01,
			0x00, 0x10, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
			0x01, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_STATFS;
		instance.TYPE = 'R_STATFS';
		instance.tag  = message.tag;

		return instance;
	}
}

class TStatFsMessage extends TMessage
{
	static responseType = RStatFsMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);

		return instance;
	}
}

class RXAttrWalkMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;

		const bytes = [
			0, 0, 0, 0,
			Constants.R_XATTRWALK,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			0x00, 0x00, 0x00, 0x00,  0x00, 0x00, 0x00, 0x00,
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_XATTRWALK;
		instance.TYPE = 'R_XATTRWALK';
		instance.tag  = message.tag;

		return instance;
	}
}

class TXAttrWalkMessage extends TMessage
{
	static responseType = RXAttrWalkMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.newFid = dataView.getUint32(11, true);
		instance.wName  = String( NString.decode(blob, 15) );

		return instance;
	}
}

class RReadMessage extends RMessage
{
	static encode(tMessage)
	{
		const file = FileService.getByFid(tMessage.fid);

		if(!file.directory)
		{
			const detail = {
				content:  null
				, file:   file ? file.path : false
				, offset: tMessage.offset
				, count:  tMessage.count
				, fid:    tMessage.fid
			};

			const readEvent = new Event('read', {cancelable: true, detail});

			if(!tMessage.offset)
			{
				process.stderr.write(`\u001b[33m READ: ${tMessage.tag} ${tMessage.fid} ${file.path}\u001b[39m `);
			}

			if(!MessageService.target.dispatchEvent(readEvent))
			{
				if(!tMessage.offset)
				{
					process.stderr.write(`[ \u001b[31mSTOP\u001b[39m ]\n`);
				}

				return RlErrorMessage.encode(tMessage);
			}

			if(!tMessage.offset)
			{
				process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);
			}

			const rMessage   = new this.prototype.constructor;

			rMessage.type    = Constants.R_READ;
			rMessage.TYPE    = 'R_READ';
			rMessage.tag     = tMessage.tag;
			rMessage.content = detail.content = !tMessage.offset
				? String(readEvent.getOverride(file.getContent()))
				: '';

			const bytes = [
				0, 0, 0, 0,
				Constants.R_READ,
				... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
				... new Uint8Array(new Uint32Array([rMessage.content.length]).buffer),
				... Buffer.from(rMessage.content, 'utf-8'),
			];

			rMessage.size = bytes[0] = bytes.length;
			rMessage.blob = Buffer.from(new Uint8Array(bytes));

			return rMessage;
		}
		else
		{
			const entries = [0, 0, 0, 0];

			const children = tMessage.offset ? [] : file.getChildren();

			const detail = {
				content:  children
				, file:   file
				, offset: tMessage.offset
				, count:  tMessage.count
				, fid:    tMessage.fid
			};

			const listEvent = new Event('list', {cancelable: true, detail});

			if(!tMessage.offset)
			{
				process.stderr.write(`\u001b[36m LIST: ${tMessage.tag} ${tMessage.fid} ${file.path}\u001b[39m `);
			}

			if(!MessageService.target.dispatchEvent(listEvent))
			{
				if(!tMessage.offset)
				{
					process.stderr.write(`[ \u001b[31mSTOP\u001b[39m ]\n`);
				}

				return RlErrorMessage.encode(tMessage);
			}

			if(!tMessage.offset)
			{
				process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);
			}

			let index = 0;

			for(const file of children)
			{
				const name = file.name;

				const mode = (file.mode << 0) + (file.directory ? 0x80000000 : 0);

				const qid   = QSession.getQid(file);
				const entry = [
					... new Uint8Array(new Uint16Array([0]).buffer),    // size
					... new Uint8Array(new Uint16Array([0]).buffer),    // type
					... new Uint8Array(new Uint32Array([0]).buffer),    // dev
					... qid,                                            // qid
					... new Uint8Array(new Uint32Array([mode]).buffer), // mode
					... new Uint8Array(new Uint32Array([Math.trunc(Date.now() / 1000)]).buffer), // atime
					... new Uint8Array(new Uint32Array([Math.trunc(Date.now() / 1000)]).buffer), // mtime
					... new Uint8Array(new BigUint64Array([BigInt(file.size ?? 0)]).buffer),     // length
					... NString.encode(file.root ? '/' : file.name),                             // Name
					... NString.encode('1000'),                                                  // uid
					... NString.encode('1000'),                                                  // gid
					... NString.encode('1000'),                                                  // muid
				];

				entries.push(...entry);
			}

			Object.assign(entries, new Uint8Array(new Uint32Array([entries.length]).buffer));

			const bytes = [
				0, 0, 0, 0,
				Constants.R_READ,
				... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
				... entries
			];

			const rMessage = new this.prototype.constructor;

			Object.assign(bytes, new Uint8Array(new Uint32Array([rMessage.size = bytes.length]).buffer));

			rMessage.size = bytes.length;
			rMessage.type = Constants.R_READ;
			rMessage.TYPE = 'R_READ';
			rMessage.tag  = tMessage.tag;

			rMessage.blob = Buffer.from(new Uint8Array(bytes));

			return rMessage;
		}
	}
}

class TReadMessage extends TMessage
{
	static responseType = RReadMessage;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.offset = dataView.getBigInt64(11, true);
		instance.count  = dataView.getUint32(19, true);

		return instance;
	}
}

class RWriteMessage extends RMessage
{
	static encode(tMessage)
	{
		const file = FileService.getByFid(tMessage.fid);

		const writeEvent = new Event('write', {cancelable: true, detail: {
			file:     file ? file.path : false
			, offset: tMessage.offset
			, count:  tMessage.count
			, fid:    tMessage.fid
			, data:   tMessage.data
		}});

		if(!tMessage.offset)
		{
			process.stderr.write(`\u001b[35mWRITE: ${tMessage.tag} ${tMessage.fid} ${file.path}\u001b[39m `);
		}

		if(!MessageService.target.dispatchEvent(writeEvent))
		{
			if(!tMessage.offset)
			{
				process.stderr.write(`[ \u001b[31m STOP\u001b[39m ]\n`);
			}

			return RlErrorMessage.encode(tMessage);
		}

		process.stderr.write(`[ \u001b[32mGO\u001b[39m ]\n`);

		const bytes = [
			0, 0, 0, 0,
			Constants.R_WRITE,
			... new Uint8Array(new Uint16Array([tMessage.tag]).buffer),
			... new Uint8Array(new Uint32Array([tMessage.count]).buffer)
		];

		file.setContent(String(writeEvent.getOverride(tMessage.data) ?? tMessage.data));

		const rMessage = new this.prototype.constructor;

		rMessage.size = bytes[0] = bytes.length;
		rMessage.blob = Buffer.from(new Uint8Array(bytes));

		rMessage.type = Constants.R_WRITE;
		rMessage.TYPE = 'R_WRITE';
		rMessage.tag  = tMessage.tag;

		return rMessage;
	}
}

class TWriteMessage extends TMessage
{
	static responseType = RWriteMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.offset = dataView.getBigInt64(11, true);
		instance.count  = dataView.getUint32(19, true);
		instance.data   = blob.slice(23);

		return instance;
	}
}

class ROpenMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;
		const file = FileService.getByFid(message.fid);

		const bytes = [
			0, 0, 0, 0,
			Constants.R_OPEN,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			... QSession.getQid(file),
			... new Uint8Array(new Uint32Array([0]).buffer),
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_OPEN;
		instance.TYPE = 'R_OPEN';
		instance.tag  = message.tag;

		return instance;
	}
}

class TOpenMessage extends TMessage
{
	static responseType = ROpenMessage;

	static parse(blob)
	{
		const instance  = super.parse(blob);
		const dataView  = instance.view;

		instance.fid    = dataView.getUint32(7, true);
		instance.mode   = dataView.getUint8(11, true);

		return instance;
	}
}

class RClunkMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;

		const bytes   = [
			0, 0, 0, 0,
			Constants.R_CLUNK,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_CLUNK;
		instance.TYPE = 'R_CLUNK';
		instance.tag  = message.tag;

		return instance;
	}
}

class TClunkMessage extends TMessage
{
	static responseType = RClunkMessage;

	static parse(blob)
	{
		const instance = super.parse(blob);
		const dataView = instance.view;

		instance.fid   = dataView.getUint32(7, true);

		return instance;
	}

	response()
	{
		FileService.forgetFid(this.fid);

		return super.response();
	}
}

class RFlushMessage extends RMessage{}
class TFlushMessage extends TMessage{}

class RlErrorMessage extends RMessage
{
	static encode(message)
	{
		const instance = new this.prototype.constructor;

		const bytes   = [
			0, 0, 0, 0,
			Constants.R_LERROR,
			... new Uint8Array(new Uint16Array([message.tag]).buffer),
			0x2, 0, 0, 0,
		];

		instance.size = bytes[0] = bytes.length;
		instance.blob = Buffer.from(new Uint8Array(bytes));

		instance.type = Constants.R_LERROR;
		instance.TYPE = 'R_LERROR';
		instance.tag  = message.tag;

		return instance;
	}
}

class MessageService
{
	static target = new EventTarget;

	static parse(blob)
	{
		let index = 0;

		const messages = [];

		while(index < blob.length)
		{
			const slice    = new Uint8Array(blob.slice(index));

			const dataView = new DataView(slice.buffer);
			const length   = dataView.getUint32(0, true);
			const current  = blob.slice(index, index + length);

			index += length;

			const message = Message.parse(current);

			switch(message.type)
			{
				case Constants.T_VERSION:
					messages.push( TVersionMessage.parse(current) );
					break;

				case Constants.R_VERSION:
					messages.push( RVersionMessage.parse(current) );
					break;

				case Constants.T_ATTACH:
					messages.push( TAttachMessage.parse(current) );
					break;

				case Constants.R_ATTACH:
					messages.push( RAttachMessage.parse(current) );
					break;

				case Constants.T_STAT:
					messages.push( TStatMessage.parse(current) );
					break;

				case Constants.R_STAT:
					messages.push( RStatMessage.parse(current) );
					break;

				case Constants.T_WSTAT:
					messages.push( TWStatMessage.parse(current) );
					break;

				case Constants.R_WSTAT:
					messages.push( RWStatMessage.parse(current) );
					break;

				case Constants.T_CLUNK:
					messages.push( TClunkMessage.parse(current) );
					break;

				case Constants.R_CLUNK:
					messages.push( RClunkMessage.parse(current) );
					break;

				case Constants.T_GETATTR:
					messages.push( TGetAttrMessage.parse(current) );
					break;

				case Constants.R_GETATTR:
					messages.push( RGetAttrMessage.parse(current) );
					break;

				case Constants.T_SETATTR:
					messages.push( TSetAttrMessage.parse(current) );
					break;

				case Constants.R_SETATTR:
					messages.push( RSetAttrMessage.parse(current) );
					break;

				case Constants.T_WALK:
					messages.push( TWalkMessage.parse(current) );
					break;

				case Constants.R_WALK:
					messages.push( RWalkMessage.parse(current) );
					break;

				case Constants.T_XATTRWALK:
					messages.push( TXAttrWalkMessage.parse(current) );
					break;

				case Constants.T_LOPEN:
					messages.push( TlOpenMessage.parse(current) );
					break;

				case Constants.R_LOPEN:
					messages.push( RlOpenMessage.parse(current) );
					break;

				case Constants.T_READDIR:
					messages.push( TReadDirMessage.parse(current) );
					break;

				case Constants.R_READDIR:
					messages.push( RReadDirMessage.parse(current) );
					break;

				case Constants.T_READ:
					messages.push( TReadMessage.parse(current) );
					break;

				case Constants.R_READ:
					messages.push( RReadMessage.parse(current) );
					break;

				case Constants.T_WRITE:
					messages.push( TWriteMessage.parse(current) );
					break;

				case Constants.R_WRITE:
					messages.push( RWriteMessage.parse(current) );
					break;

				case Constants.T_STATFS:
					messages.push( TStatFsMessage.parse(current) );
					break;

				case Constants.R_STATFS:
					messages.push( RStatFsMessage.parse(current) );
					break;

				case Constants.T_OPEN:
					messages.push( TOpenMessage.parse(current) );
					break;

				case Constants.R_OPEN:
					messages.push( ROpenMessage.parse(current) );
					break;

				case Constants.T_FLUSH:
					messages.push( TFlushMessage.parse(current) );
					break;

				case Constants.R_FLUSH:
					messages.push( RFlushMessage.parse(current) );
					break;

				default:
					messages.push( Message.parse(current) );
					break;
			}
		}

		return messages;
	}
}

module.exports = { MessageService };