var sys = require('sys')
,crypto = require('crypto')
,b64decode = require('base64').decode
,fs = require('fs')
,Buffer = require('buffer').Buffer
,xml2js = require('xml2js')
,http = require('http')
,url = require('url')
,request = require('request')
,path = require('path')
,fshelp = require('./file');

var MAX_DOWNLOADS = 5;
var KEY = '\x29\xAB\x9D\x18\xB2\x44\x9E\x31';
var IV = '\x5E\x72\xD7\x9A\x11\xB3\x4F\xEE';

exports.process = function(saveRoot, file) {
  sys.debug('Concurrent downloads limited to ' + MAX_DOWNLOADS + '.\n');

  var amz_data = "";
  if (file instanceof Buffer) {
    amz_data = file.toString('ascii', 0, file.length);
  } else {
    amz_data = fs.readFileSync(process.argv[3], 'binary');
  }

  var toDownload = [];
  var dlCount = 0;

  function decrypt(data) {
    var b = new Buffer(data.length);
    b.write(amz_data, 'binary');

    var decipher=(new crypto.Decipher).initiv("des-cbc", KEY, IV);
    var amz_xml = decipher.update(b64decode(b), 'binary', 'utf8');
    amz_xml += decipher['final']('utf8');
    return amz_xml;
  }

  var parser = new xml2js.Parser();
  parser.addListener('end', function(obj) {
		       var tracks = obj.trackList.track;
		       if (!(tracks instanceof Array)) {
			 tracks = [tracks];
		       }

		       //sys.puts(sys.inspect(tracks));
		       for (var i = 0; i < tracks.length; i++) {
			 var track = tracks[i];
			 var size;
			 var primary;
			 var meta_len = track.meta.length;
			 for (var j = 0; j < meta_len; j++) {
			   var meta = track.meta[j];
			   if (meta['@'].rel == "http://www.amazon.com/dmusic/fileSize") {
			     size = meta['#'];
			   } else if (meta['@'].rel == "http://www.amazon.com/dmusic/albumPrimaryArtist") {
			     primary = meta['#'];
			   }
			 }
			 var track_url = url.parse(track.location, true);
			 var uri = track_url.query.URL;
			 var creator = track.creator;
			 var album = track.album;
			 var title = track.title;

			 //get ready to download
			 toDownload.push({uri: uri, primary: primary||creator, album: album, title: title});
		       }


		       sys.puts('Preparing to download ' + toDownload.length + ' tracks.');
		       downloadFiles();
		     });

  function downloadFiles() {
    if (toDownload.length > 0) {
      if (dlCount < MAX_DOWNLOADS) {
	var o = toDownload.pop();
	dlCount++;
	sys.puts('primary: '+o.primary);
	sys.puts('album: '+o.album);
	sys.puts('title: '+o.title);
	getFile(o.uri, o.primary, o.album, o.title);
      }
      setTimeout(downloadFiles, 1000);
    } else {
      sys.puts('No more files to enqueue for download. Finishing downloads.');
    }
  }

  function getFile(uri, primary, album, title) {
    var dirpath = path.join(saveRoot, primary, album);
    var filepath = path.join(dirpath, title + '.mp3');
    if (path.existsSync(filepath)) {
      dlCount--;
      sys.puts("File '" + filepath + "' exists. Skipping download.");
      return;
    }
    sys.puts("Writing '"+filepath+"'...");
    fshelp.mkdirs(dirpath, 0777, function(err) {
		    if (err) throw err;
		    fs.open(filepath, 'w', 0755, function(err, fd) {
			      if (err) throw err;
			      var s = fs.createWriteStream(filepath);
			      s.on('close', function(err) {
				     if (err) throw err;
				     fs.close(fd, function(err) {
						if (err) throw err;
						sys.puts("File '"+filepath+"' has been written, try it out.");
						dlCount--;
						if (dlCount == 0 && toDownload.length == 0) sys.puts('\nYour files have been downloaded. Enjoy.');
					      });
				   });
			      request({uri: uri, responseBodyStream: s}, function (err, response, stream) {
					if (err) sys.puts('Error: ' + err);
				      });
			    });

		  });
  };

  parser.parseString(decrypt(amz_data));
};