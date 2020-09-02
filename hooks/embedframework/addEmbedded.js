'use strict';

const xcode = require('xcode'),
    fs = require('fs'),
    path = require('path');
    const chalk = require('chalk');

module.exports = function(context) {
    if(process.length >=5 && process.argv[1].indexOf('cordova') == -1) {
        if(process.argv[4] != 'ios') {
            return; // plugin only meant to work for ios platform.
        }
    }

    function fromDir(startPath,filter, rec, multiple){
        if (!fs.existsSync(startPath)){
            console.log("no dir ", startPath);
            return;
        }

        const files=fs.readdirSync(startPath);
        var resultFiles = []
        for(var i=0;i<files.length;i++){
            var filename=path.join(startPath,files[i]);
            var stat = fs.lstatSync(filename);
            if (stat.isDirectory() && rec){
                fromDir(filename,filter); //recurse
            }
            // console.log(filename)
            if (filename.indexOf(filter)>=0) {
                if (multiple) {
                    resultFiles.push(filename);
                } else {
                    return filename;
                }
            }
        }
        if(multiple) {
            return resultFiles;
        }
    }

    function getFileIdAndRemoveFromFrameworks(myProj, fileBasename) {
        var fileId = '';
        const pbxFrameworksBuildPhaseObjFiles = myProj.pbxFrameworksBuildPhaseObj(myProj.getFirstTarget().uuid).files;
        for(var i=0; i<pbxFrameworksBuildPhaseObjFiles.length;i++) {
            var frameworkBuildPhaseFile = pbxFrameworksBuildPhaseObjFiles[i];
            if(frameworkBuildPhaseFile.comment && frameworkBuildPhaseFile.comment.indexOf(fileBasename) != -1) {
                fileId = frameworkBuildPhaseFile.value;
                pbxFrameworksBuildPhaseObjFiles.splice(i,1); // MUST remove from frameworks build phase or else CodeSignOnCopy won't do anything.
                break;
            }
        }
        return fileId;
    }

    function getFileRefFromName(myProj, fName) {
        const fileReferences = myProj.hash.project.objects['PBXFileReference'];
        var fileRef = '';
        for(var ref in fileReferences) {
            if(ref.indexOf('_comment') == -1) {
                var tmpFileRef = fileReferences[ref];
                if(tmpFileRef.name && tmpFileRef.name.indexOf(fName) != -1) {
                    fileRef = ref;
                    break;
                }
            }
        }
        return fileRef;
    }

    const xcodeProjPath = fromDir('platforms/ios','.xcodeproj', false);
    const projectPath = xcodeProjPath + '/project.pbxproj';
    const myProj = xcode.project(projectPath);

    function addRunpathSearchBuildProperty(proj, build) {
       const LD_RUNPATH_SEARCH_PATHS =  proj.getBuildProperty("LD_RUNPATH_SEARCH_PATHS", build);
       if(!LD_RUNPATH_SEARCH_PATHS) {
          proj.addBuildProperty("LD_RUNPATH_SEARCH_PATHS", "\"$(inherited) @executable_path/Frameworks\"", build);
       } else if(LD_RUNPATH_SEARCH_PATHS.indexOf("@executable_path/Frameworks") == -1) {
          var newValue = LD_RUNPATH_SEARCH_PATHS.substr(0,LD_RUNPATH_SEARCH_PATHS.length-1);
          newValue += ' @executable_path/Frameworks\"';
          proj.updateBuildProperty("LD_RUNPATH_SEARCH_PATHS", newValue, build);
       }
    }

    myProj.parseSync();
    addRunpathSearchBuildProperty(myProj, "Debug");
    addRunpathSearchBuildProperty(myProj, "Release");

    // unquote (remove trailing ")
    // var projectName = myProj.getFirstTarget().firstTarget.name.substr(1);
    var projectName = myProj.getFirstTarget().firstTarget.name;
    // projectName = projectName.substr(1, projectName.length-2); //Removing the char " at beginning and the end.
    projectName = projectName.replace(/"/g, '');

    const groupName = 'Embed Frameworks ' + context.opts.plugin.id;
    console.log(chalk.red(groupName))
    const pluginPathInPlatformIosDir = projectName + '/Plugins/' + context.opts.plugin.id;

    console.log('test', process.cwd());
    process.chdir('./platforms/ios');
    console.log('test2', process.cwd());
    console.log(myProj.getFirstTarget().firstTarget.name, pluginPathInPlatformIosDir);
    const frameworkFilesToEmbed = fromDir(pluginPathInPlatformIosDir, '.framework', false, true);
    console.log('test3', frameworkFilesToEmbed)
    process.chdir('../../');

    if(!frameworkFilesToEmbed.length) return;

    myProj.addBuildPhase(frameworkFilesToEmbed, 'PBXCopyFilesBuildPhase', groupName, myProj.getFirstTarget().uuid, 'frameworks');

    for(var frmFileFullPath of frameworkFilesToEmbed) {
        var justFrameworkFile = path.basename(frmFileFullPath);
        var fileRef = getFileRefFromName(myProj, justFrameworkFile);
        var fileId = getFileIdAndRemoveFromFrameworks(myProj, justFrameworkFile);

        // Adding PBXBuildFile for embedded frameworks
        var file = {
            uuid: fileId,
            basename: justFrameworkFile,
            settings: {
                ATTRIBUTES: ["CodeSignOnCopy", "RemoveHeadersOnCopy"]
            },

            fileRef:fileRef,
            group:groupName
        };
        console.log(file)
        myProj.addToPbxBuildFileSection(file);


        // Adding to Frameworks as well (separate PBXBuildFile)
        var newFrameworkFileEntry = {
            uuid: myProj.generateUuid(),
            basename: justFrameworkFile,

            fileRef:fileRef,
            group: "Frameworks"
        };
        myProj.addToPbxBuildFileSection(newFrameworkFileEntry);
        myProj.addToPbxFrameworksBuildPhase(newFrameworkFileEntry);
    }

    fs.writeFileSync(projectPath, myProj.writeSync());
    console.log('Embedded Frameworks In22 ' + context.opts.plugin.id);
};
