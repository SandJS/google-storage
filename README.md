# Google Storage Sand Grain

### Config

| name | description |
| ---- | ----------- |
| bucket | The name of the main bucket |
| tmpBucket | The name of the temporary bucket |

### Usage
```js
const storage = require('sand-googled-storage');

new Sand()
	.use(storage)
	.start();
```

```js
// Read a file from google storage
sand.storage.bucket().file('myFile.jpg').createReadStream();

// Write a file to google storage
sand.storage.bucket().file('myFile.jpg').createWriteStream();
```
	

## Methods

### Sand Grain
Methods that are attached to `sand.storage`

#### storage()
Returns a new Storage Object

#### bucket(name)
Set the bucket or use the default set in the config.
Returns a new Storage Object

#### tmpBucket(name)
Set the tmp bucket or use the default set in the config.
Returns a new Storage Object

#### file(path)
Set the file path to a file for uploading or reading.
Returns a new Storaged Object

### Storage
Methods that are on the Storage Object

#### createReadStream()
Returns a new read stream to download file

#### createWriteStream()
Returns a new write stream to upload file

#### download(options)
Download a file into memory or a file with passed in `options.destination`

#### deleteFiles()
Delete Files that matched query [Some Options](https://cloud.google.com/storage/docs/json_api/v1/objects/list)

#### deleteFile(path)
Delete file at path in current bucket

#### delete()
Delete the current file in the current bucket