using System;

namespace Fusion
{
    // Wire format of the fusion server (server/src/app.js). Plain fields so JsonUtility can (de)serialize them.

    [Serializable] public class CharacterDto { public string id; public string name; public string tier; public string thumb; }

    [Serializable] public class BootstrapDto { public long version; public int sasTtlMinutes; public CharacterDto[] characters; }

    [Serializable] public class PartnersDto { public string id; public CharacterDto[] partners; }

    [Serializable] public class ResultDto { public string id; public string name; }

    [Serializable] public class VideoDto { public string url; public string expiresAt; public string etag; public long bytes; }

    [Serializable] public class MergeDto { public string pairKey; public ResultDto result; public VideoDto video; }

    /// <summary>POST /merge body. A named type: JsonUtility cannot serialize anonymous objects.</summary>
    [Serializable] public class MergeRequest { public string a; public string b; }

    [Serializable] public class ApiError { public string error; public string message; }
}
