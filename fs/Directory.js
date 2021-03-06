const File = require('./File').File;

class Directory extends File
{
	mode      = 0o755;
	directory = true;
	children  = new Set;

	constructor(props = {})
	{
		super(props);

		for(const prop of Object.getOwnPropertyNames(this))
		{
			this[prop] = props[prop] ?? this[prop];
		}

		if(this.path == '/')
		{
			this.name = '/';
		}
	}

	canWalkTo(name)
	{
		const names = new Set(this.getChildren().map(c => c.name));

		return names.has(name);
	}

	getChildren()
	{
		return [...this.children];
	}

	addChildren(...children)
	{
		children.forEach(c => {
			c.parent = this
			this.children.add(c);
		});

	}

	newFile(name, exists = true)
	{
		return;

		// const file = new File({name,exists,parent:this});

		// this.addChildren(file);

		// return file;
	}
}

module.exports = { Directory };
